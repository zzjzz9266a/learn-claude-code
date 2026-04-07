import { describe, expect, test } from "vitest";
import { BackgroundManager } from "../src/core/reference-agent";

describe("BackgroundManager", () => {
  test("check returns running placeholder when result is null", () => {
    const manager = new BackgroundManager();
    manager.tasks.set("abc123", {
      status: "running",
      command: "sleep 1",
      result: null
    });

    expect(manager.check("abc123")).toBe("[running] (running)");
  });
});
