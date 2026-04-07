import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("documentation", () => {
  test("README quick start points at TypeScript entrypoints", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("npm install");
    expect(readme).toContain("npm run s01");
  });
});
