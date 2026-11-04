import { Router } from "express";
import { prisma } from "../lib/prisma";

export const statsRouter = Router();

// Counts for the dashboard header: { videos: { READY_FOR_REVIEW: 3, ... }, topics: { PENDING: 40, ... } }
statsRouter.get("/", async (_req, res) => {
  const [videos, topics] = await Promise.all([
    prisma.video.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.topic.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  res.json({
    videos: Object.fromEntries(videos.map((r) => [r.status, r._count._all])),
    topics: Object.fromEntries(topics.map((r) => [r.status, r._count._all])),
  });
});
