import path from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { queues } from "./pipeline/queues";
import { scrapeQueue } from "./scraper/queue";
import { healthRouter } from "./routes/health";
import { statsRouter } from "./routes/stats";
import { topicsRouter } from "./routes/topics";
import { videosRouter } from "./routes/videos";
import { errorHandler, notFound } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  // Bull Board (queue monitoring UI), helmet er age mount, nahole UI er script block hoy
  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: [...Object.values(queues), scrapeQueue].map((q) => new BullMQAdapter(q)),
    serverAdapter: boardAdapter,
  });
  app.use("/admin/queues", boardAdapter.getRouter());

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_ORIGIN }));

  // Generated videos, thumbnails and captions. Range requests work, so a <video> tag can seek.
  // helmet marks every response "same-origin only", which would stop the dashboard (another origin)
  // from showing these files, so media gets its own header.
  app.use(
    "/media",
    (_req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(path.resolve(process.cwd(), env.STORAGE_DIR), { index: false, dotfiles: "deny" })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  app.use("/api/health", healthRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/topics", topicsRouter);
  app.use("/api/videos", videosRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
