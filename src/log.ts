import pino from "pino";
import { loadConfig } from "./config";

const cfg = loadConfig();
export const log = pino({ level: cfg.LOG_LEVEL });
