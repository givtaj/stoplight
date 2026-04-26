import { describe, expect, it } from "vitest";

import { normalizeOrigins, parseHeaderText } from "./utils";

describe("shared utils", () => {
  it("parses raw header text into editable pairs", () => {
    expect(
      parseHeaderText("content-type: application/json\nx-debug: 1"),
    ).toEqual([
      { name: "content-type", value: "application/json" },
      { name: "x-debug", value: "1" },
    ]);
  });

  it("normalizes origins and drops invalid rows", () => {
    expect(
      normalizeOrigins([
        "https://example.com/path",
        "notaurl",
        "https://api.example.com/v1",
        "https://example.com/dashboard",
      ]),
    ).toEqual(["https://example.com", "https://api.example.com"]);
  });
});
