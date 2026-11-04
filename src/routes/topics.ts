import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { scrapeQueue } from "../scraper/queue";

export const topicsRouter = Router();

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
});

const listSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "USED", "REJECTED"]).optional(),
  source: z.enum(["GOOGLE_TRENDS", "REDDIT", "HACKER_NEWS", "DEV_TO", "MANUAL"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

topicsRouter.post("/", async (req, res) => {
  const body = createSchema.parse(req.body);
  const topic = await prisma.topic.upsert({
    where: { title_source: { title: body.title, source: "MANUAL" } },
    update: {},
    create: { title: body.title, source: "MANUAL" },
  });
  res.status(201).json(topic);
});

topicsRouter.get("/", async (req, res) => {
  const q = listSchema.parse(req.query);
  const topics = await prisma.topic.findMany({
    where: { status: q.status, source: q.source },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: q.limit,
  });
  res.json(topics);
});

// Manual trigger: queue a scrape right now
topicsRouter.post("/scrape", async (_req, res) => {
  await scrapeQueue.add("scrape-now", {});
  res.status(202).json({ queued: true });
});

// "Not interested in this topic": only a topic that is still waiting can be rejected
topicsRouter.post("/:id/reject", async (req, res) => {
  const result = await prisma.topic.updateMany({
    where: { id: req.params.id, status: "PENDING" },
    data: { status: "REJECTED" },
  });
  if (result.count === 0) {
    throw new AppError(409, "Only a topic that is still PENDING can be rejected");
  }
  res.json({ ok: true });
});
