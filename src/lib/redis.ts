import { env } from "../config/env";

const url = new URL(env.REDIS_URL);

export const redisConnection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  username: url.username || undefined,
  password: url.password || undefined,
  maxRetriesPerRequest: null as null,
};