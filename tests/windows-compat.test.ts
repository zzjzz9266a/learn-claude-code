import { beforeEach, describe, expect, test, vi } from "vitest";
import { win32 } from "node:path";

describe("Windows compatibility", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("isMainModule handles Windows file URLs and argv paths", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "C:\\repo\\agents\\s01_agent_loop.ts"];

    const { isMainModule } = await import("../src/core/repl");

    expect(isMainModule("file:///C:/repo/agents/s01_agent_loop.ts")).toBe(true);
    expect(isMainModule("file:///C:/repo/agents/s02_tool_use.ts")).toBe(false);

    process.argv = originalArgv;
  });

  test("safePath rejects sibling paths that only share a prefix on Windows", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("C:\\repo");

    const { safePath } = await import("../src/core/reference-agent");

    expect(() => safePath("src\\index.ts")).not.toThrow();
    expect(() => safePath("..\\repo-other\\secret.txt")).toThrow();
  });

  test("safePath accepts nested Windows workspace paths", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("C:\\repo");

    const { safePath } = await import("../src/core/reference-agent");

    expect(safePath("nested\\file.ts")).toBe(win32.resolve("C:\\repo", "nested\\file.ts"));
  });
});
