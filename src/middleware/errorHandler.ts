import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.issues });
    return;
  }

  const statusCode = err instanceof AppError ? err.statusCode : 500;

  if (statusCode >= 500) {
    logger.error({ err }, "Unhandled error");
  }

  res.status(statusCode).json({
    error: statusCode >= 500 ? "Internal server error" : err.message,
  });
};