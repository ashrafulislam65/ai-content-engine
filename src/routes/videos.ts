import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { createVideoForTopic, retryVideo } from "../pipeline/service";
import { toDetail, toListItem } from "../review/dto";
import { approveVideo, regenerateVideo, rejectVideo, updateScript } from "../review/service";

export const videosRouter = Router();

const STATUSES = [
  "QUEUED",
  "SCRIPTING",
  "VOICING",
  "FETCHING_ASSETS",
  "RENDERING",
  "READY_FOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "SCHEDULED",
  "PUBLISHED",
  "FAILED",
] as const;
const STAGES = ["script", "voice", "assets", "render"] as const;

const createSchema = z.object({
  topicId: z.string().min(1),
});

const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

const rejectSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  rejectTopic: z.boolean().default(false),
});

const regenerateSchema = z.object({
  from: z.enum(STAGES),
});

const scriptSchema = z
  .object({
    title: z.string().trim().min(5).max(100).optional(),
    scriptText: z.string().trim().min(300).max(1500).optional(),
    rerun: z.boolean().default(true),
  })
  .refine((v) => v.title !== undefined || v.scriptText !== undefined, {
    message: "Send a title and/or a scriptText",
  });

// Start a new video for a topic
videosRouter.post("/", async (req, res) => {
  const body = createSchema.parse(req.body);
  const video = await createVideoForTopic(body.topicId);
  res.status(201).json(video);
});

// Dashboard list: newest first, optional ?status=READY_FOR_REVIEW, paged with ?cursor=<nextCursor>
videosRouter.get("/", async (req, res) => {
  const q = listSchema.parse(req.query);

  const rows = await prisma.video.findMany({
    where: { status: q.status },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: { topic: { select: { id: true, title: true, source: true } } },
  });

  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  res.json({
    items: page.map(toListItem),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});

videosRouter.get("/:id", async (req, res) => {
  const video = await prisma.video.findUnique({
    where: { id: req.params.id },
    include: {
      topic: true,
      logs: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!video) throw new AppError(404, "Video not found");
  res.json(toDetail(video));
});

// A failed video: run the stage that failed again
videosRouter.post("/:id/retry", async (req, res) => {
  await retryVideo(req.params.id);
  res.json({ ok: true });
});

videosRouter.post("/:id/approve", async (req, res) => {
  await approveVideo(req.params.id);
  res.json({ ok: true });
});

videosRouter.post("/:id/reject", async (req, res) => {
  const body = rejectSchema.parse(req.body ?? {});
  await rejectVideo(req.params.id, body);
  res.json({ ok: true });
});

// Redo one stage (and what depends on it): { "from": "script" | "voice" | "assets" | "render" }
videosRouter.post("/:id/regenerate", async (req, res) => {
  const body = regenerateSchema.parse(req.body);
  await regenerateVideo(req.params.id, body.from);
  res.status(202).json({ ok: true });
});

// Fix the script by hand. Changing scriptText re-records the voice, unless "rerun": false
videosRouter.patch("/:id/script", async (req, res) => {
  const body = scriptSchema.parse(req.body);
  const result = await updateScript(req.params.id, body);
  res.json({ ok: true, ...result });
});
