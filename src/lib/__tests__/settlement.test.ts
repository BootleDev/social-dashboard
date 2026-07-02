import { describe, it, expect } from "vitest";
import { isPostSettled } from "@/lib/settlement";
import type { AirtableRecord } from "@/lib/utils";

const post = (platform: string, publishedDaysAgo: number): AirtableRecord => ({
  id: "x",
  fields: { Platform: platform, "Published At": new Date(Date.now() - publishedDaysAgo * 86400000).toISOString() },
  createdTime: "",
});
const today = new Date().toISOString().split("T")[0];

describe("isPostSettled", () => {
  it("FB settles after 3 days", () => {
    expect(isPostSettled(post("facebook", 5), today)).toBe(true);
    expect(isPostSettled(post("facebook", 2), today)).toBe(false);
  });
  it("IG settles after 21 days", () => {
    expect(isPostSettled(post("instagram", 10), today)).toBe(false);
    expect(isPostSettled(post("instagram", 25), today)).toBe(true);
  });
  it("non-FB/IG (pinterest) is never gated", () => {
    expect(isPostSettled(post("pinterest", 1), today)).toBe(true);
  });
  it("missing publish date is treated as settled (do not hide)", () => {
    expect(isPostSettled({ id: "x", fields: { Platform: "instagram" }, createdTime: "" }, today)).toBe(true);
  });
});
