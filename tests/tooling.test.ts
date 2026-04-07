import pkg from "../package.json";
import { describe, expect, test } from "vitest";

describe("tooling scaffold", () => {
  test("root package metadata exists", () => {
    expect(pkg.name).toBe("learn-claude-code");
  });
});
