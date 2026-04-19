import pino from "pino";

function getLogLevel(): string {
  try {
    const { loadConfig } = require("./config") as typeof import("./config");
    return loadConfig().LOG_LEVEL;
  } catch {
    return "info";
  }
}

export const log = pino({ level: getLogLevel() });
