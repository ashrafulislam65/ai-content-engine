import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { createVideoForTopic, retryVideo } from "../pipeline/service";

export const videosRouter = Router();

const createSchema = z.object({
  topicId: z.string().min(1),
});

videosRouter.post("/", async (req, res) => {
  const body = createSchema.parse(req.body);
  const video = await createVideoForTopic(body.topicId);
  res.status(201).json(video);
});

videosRouter.get("/", async (_req, res) => {
  const videos = await prisma.video.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { topic: { select: { title: true } } },
  });
  res.json(videos);
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
  res.json(video);
});

videosRouter.post("/:id/retry", async (req, res) => {
  await retryVideo(req.params.id);
  res.json({ ok: true });
});