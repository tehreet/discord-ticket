import pino from "pino";

const VALID_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
const envLevel = process.env.LOG_LEVEL ?? "info";
const level = (VALID_LEVELS as readonly string[]).includes(envLevel)
  ? envLevel
  : "info";

export const log = pino({ level });
