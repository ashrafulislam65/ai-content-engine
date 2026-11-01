import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const topicsRouter = Router();

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
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

topicsRouter.get("/", async (_req, res) => {
  const topics = await prisma.topic.findMany({
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  res.json(topics);
});