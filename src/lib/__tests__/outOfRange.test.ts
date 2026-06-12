import { describe, it, expect } from "vitest";
import type { AirtableRecord } from "@/lib/utils";

/**
 * Mirrors the "hidden platform" detection in OutOfRangeNotice: a platform that
 * has posts in the dataset but none in the filtered range. Kept as a pure
 * function here so the logic is unit-tested without rendering React.
 */
function hiddenPlatforms(
  allPosts: AirtableRecord[],
  filteredPosts: AirtableRecord[],
  selectedPlatforms: Set<string>,
): string[] {
  const platformsOf = (records: AirtableRecord[]) => {
    const set = new Set<string>();
    for (const r of records) {
      const p = String(r.fields["Platform"] ?? "").toLowerCase().trim();
      if (p) set.add(p);
    }
    return set;
  };
  const inData = platformsOf(allPosts);
  const inRange = platformsOf(filteredPosts);
  const considered = (p: string) =>
    selectedPlatforms.size === 0 || selectedPlatforms.has(p);
  return Array.from(inData)
    .filter((p) => considered(p) && !inRange.has(p))
    .sort();
}

const post = (platform: string): AirtableRecord => ({
  id: `rec_${platform}`,
  fields: { Platform: platform },
  createdTime: "",
});

describe("hiddenPlatforms (OutOfRangeNotice logic)", () => {
  it("flags a platform present in data but absent from the range", () => {
    const all = [post("instagram"), post("pinterest")];
    const filtered = [post("instagram")]; // pinterest fell outside the range
    expect(hiddenPlatforms(all, filtered, new Set())).toEqual(["pinterest"]);
  });

  it("returns nothing when every data platform is in range", () => {
    const all = [post("instagram"), post("facebook")];
    const filtered = [post("instagram"), post("facebook")];
    expect(hiddenPlatforms(all, filtered, new Set())).toEqual([]);
  });

  it("ignores platforms not in the active selection", () => {
    const all = [post("instagram"), post("pinterest")];
    const filtered = [post("instagram")];
    // Only Instagram selected, so a hidden Pinterest should not be flagged.
    expect(
      hiddenPlatforms(all, filtered, new Set(["instagram"])),
    ).toEqual([]);
  });

  it("flags multiple hidden platforms, sorted", () => {
    const all = [post("tiktok"), post("pinterest"), post("instagram")];
    const filtered = [post("instagram")];
    expect(hiddenPlatforms(all, filtered, new Set())).toEqual([
      "pinterest",
      "tiktok",
    ]);
  });

  it("returns nothing when there is no data at all", () => {
    expect(hiddenPlatforms([], [], new Set())).toEqual([]);
  });
});
