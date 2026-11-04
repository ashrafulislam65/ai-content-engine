import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { VideoStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { videoDir } from "../lib/storage";
import { AppError } from "../middleware/errorHandler";
import { enqueueStage } from "../pipeline/queues";
import { logStage } from "../pipeline/service";
import { STAGE_CONFIG } from "../pipeline/stages";
import { type Action, type Stage, allowedStatuses, canDo, clearPlan, missingPrereq } from "./rules";

async function getVideoOr404(id: string) {
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) throw new AppError(404, "Video not found");
  return video;
}

function assertAllowed(action: Action, status: VideoStatus) {
  if (!canDo(action, status)) {
    throw new AppError(409, `Cannot ${action} a video that is ${status}`);
  }
}

// Change the status only if it is still what we think it is, so two people clicking at once cannot both win
async function claim(id: string, action: Action, data: Prisma.VideoUpdateManyMutationInput) {
  const res = await prisma.video.updateMany({
    where: { id, status: { in: allowedStatuses(action) } },
    data,
  });
  if (res.count !== 1) {
    throw new AppError(409, "The video was changed by someone else just now. Reload and try again");
  }
}

export async function approveVideo(id: string) {
  const video = await getVideoOr404(id);
  assertAllowed("approve", video.status);

  await claim(id, "approve", { status: "APPROVED" });
  await prisma.topic.update({ where: { id: video.topicId }, data: { status: "USED" } });
  await logStage(id, "review", "INFO", "Approved");
}

export async function rejectVideo(id: string, opts: { reason?: string; rejectTopic: boolean }) {
  const video = await getVideoOr404(id);
  assertAllowed("reject", video.status);

  await claim(id, "reject", { status: "REJECTED" });
  // The topic goes back to the queue, unless the reviewer says the topic itself is bad
  await prisma.topic.update({
    where: { id: video.topicId },
    data: { status: opts.rejectTopic ? "REJECTED" : "PENDING" },
  });
  await logStage(id, "review", "WARN", `Rejected${opts.reason ? `: ${opts.reason}` : ""}`);
}

export async function regenerateVideo(id: string, from: Stage) {
  const video = await getVideoOr404(id);
  assertAllowed("regenerate", video.status);

  const problem = missingPrereq(from, video);
  if (problem) throw new AppError(409, problem);
  const previousStatus = video.status;

  // 1. Take the video (status QUEUED locks every other action)
  await claim(id, "regenerate", { status: "QUEUED" });

  // 2. Delete what depends on the redone stage. If a file is locked (a player has it open), undo and say so.
  const plan = clearPlan(from);
  const dir = videoDir(id);
  for (const name of plan.files) {
    try {
      await fs.rm(path.join(dir, name), { recursive: true, force: true });
    } catch {
      await prisma.video.updateMany({ where: { id }, data: { status: previousStatus } });
      throw new AppError(409, `Could not delete ${name}. Close any player that has it open and try again`);
    }
  }

  // 3. Forget it in the database too
  const data: Prisma.VideoUpdateManyMutationInput = { failedStage: null, errorMessage: null };
  for (const field of plan.fields) {
    switch (field) {
      case "title": data.title = null; break;
      case "scriptText": data.scriptText = null; break;
      case "visualKeywords": data.visualKeywords = []; break;
      case "audioPath": data.audioPath = null; break;
      case "audioDurationSec": data.audioDurationSec = null; break;
      case "subtitlePath": data.subtitlePath = null; break;
      case "assets": data.assets = Prisma.DbNull; break;
      case "videoPath": data.videoPath = null; break;
    }
  }
  await prisma.video.update({ where: { id }, data });
  await prisma.topic.update({ where: { id: video.topicId }, data: { status: "IN_PROGRESS" } });
  await logStage(id, "review", "INFO", `Regenerating from the ${from} stage`);

  // 4. Start the pipeline again. If Redis is down, do not leave the video stuck in QUEUED.
  try {
    await enqueueStage(from, id);
  } catch (err) {
    await prisma.video.update({
      where: { id },
      data: {
        status: "FAILED",
        failedStage: STAGE_CONFIG[from].status,
        errorMessage: `Could not queue the job: ${(err as Error).message}`,
      },
    });
    throw new AppError(503, "Could not queue the job. Is Redis running? Use Retry once it is");
  }
}

export async function updateScript(
  id: string,
  patch: { title?: string; scriptText?: string; rerun: boolean }
): Promise<{ rerun: boolean }> {
  const video = await getVideoOr404(id);
  assertAllowed("editScript", video.status);
  if (!video.scriptText) throw new AppError(409, "This video has no script yet");
  const oldScriptText = video.scriptText;

  const data: Prisma.VideoUpdateManyMutationInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.scriptText !== undefined) data.scriptText = patch.scriptText;

  await claim(id, "editScript", data);
  await logStage(id, "review", "INFO", "Script edited by the reviewer");

  // A new script means a new narration (and a new render). Title changes need nothing.
  const textChanged = patch.scriptText !== undefined && patch.scriptText !== oldScriptText;
  if (textChanged && patch.rerun) {
    await regenerateVideo(id, "voice");
    return { rerun: true };
  }
  return { rerun: false };
}
