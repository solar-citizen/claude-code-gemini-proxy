import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";

mock.module("fs", () => {
  return {
    mkdirSync: mock(),
    statSync: mock(() => ({ size: 0 })),
    renameSync: mock(),
    appendFile: mock(() => {}),
  };
});

import { log, debugLog, getLogFilePath } from "../../src/utils/logger.util";
import { config } from "../../src/config";

describe("Logger Util", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("has a default LOG_LEVEL of 1 in tests", () => {
    expect(config.logLevel).toBe(1);
  });

  it("getLogFilePath returns a path containing proxy-", () => {
    const path = getLogFilePath();
    expect(path).toContain("proxy-");
    expect(path).toContain(".log");
  });

  it("log does nothing if LOG_LEVEL === 1", () => {
    log("info", "test no logs", { some: "data" });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("debugLog does nothing if LOG_LEVEL === 1", () => {
    debugLog("test debug logs", { some: "data" });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
