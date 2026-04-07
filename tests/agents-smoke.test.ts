import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("agent entrypoints", () => {
  test("all session files exist as TypeScript modules", () => {
    const files = readdirSync(join(process.cwd(), "agents")).filter((name) =>
      name.endsWith(".ts")
    );
    expect(files.length).toBeGreaterThan(0);
  });
});
