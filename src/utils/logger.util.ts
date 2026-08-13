import { mkdirSync, statSync, renameSync, appendFile } from "fs";
import { join } from "path";
import { getErrorMessage, isErrnoException } from "./error.util";
import { config } from "../config";

const logDir = join(import.meta.dir, "../../logs");
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, `proxy-${new Date().toISOString().slice(0, 10)}.log`);
const logMaxBytes = 5_242_880;
const logFlushMs = 2_000;

let logBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function rotateIfNeeded() {
  let size: number;

  try {
    ({ size } = statSync(logFile));
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      // Expected on first run / after rotation — nothing to rotate yet.
      return;
    }

    /**
     * Anything else (permissions, disk issues, ...) is worth knowing about
     * rather than silently swallowing. Goes to stderr directly since routing
     * it through log() here would re-enter the flush/rotate path.
     */
    console.error("log rotation check failed:", getErrorMessage(err));
    return;
  }

  if (size > logMaxBytes) {
    renameSync(logFile, logFile.replace(/\.log$/, `.${Date.now()}.log`));
  }
}

function flushLogs() {
  flushTimer = null;

  if (logBuffer.length === 0) {
    return;
  }

  rotateIfNeeded();
  const chunk = logBuffer.join("");
  logBuffer = [];

  appendFile(logFile, chunk, (err: NodeJS.ErrnoException | null) => {
    if (err) {
      console.error("log write failed:", getErrorMessage(err));
    }
  });
}

export function log(level: "info" | "error", msg: string, data?: unknown) {
  if (config.logLevel === 1) {
    return;
  }

  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    msg,
  };

  if (config.logLevel === 3 && data !== undefined) {
    entry.data = data;
  }

  logBuffer.push(JSON.stringify(entry) + "\n\n\n");

  if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, logFlushMs);
  }

  console.log(`[${level}] ${msg}`);
}

export function debugLog(msg: string, data?: unknown) {
  if (config.logLevel === 3) {
    log("info", msg, data);
  }
}

export function getLogFilePath(): string {
  return logFile;
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    flushLogs();
    process.exit(0);
  });
}