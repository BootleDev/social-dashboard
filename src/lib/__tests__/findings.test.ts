import { describe, it, expect } from "vitest";
import { generateFindings } from "../findings";
import type { AirtableRecord } from "../utils";

let seq = 0;
/** A post in a given Theme × Post Type with a set engagement + ER. */
function post(
  theme: string,
  type: string,
  engagement: number,
  er: number,
): AirtableRecord {
  seq += 1;
  return {
    id: `rec_${seq}`,
    fields: {
      "Content Theme": theme,
      "Post Type": type,
      "Content Pillar": "pillar",
      "Tagging Status": "Tagged",
      Engagement: engagement,
      "Engagement Rate": er,
      Impressions: 1000,
      Platform: "instagram",
    },
    createdTime: "2026-05-01T00:00:00.000Z",
  };
}

/** N posts of the same Theme × Type. */
function group(
  theme: string,
  type: string,
  n: number,
  engagement: number,
  er: number,
): AirtableRecord[] {
  return Array.from({ length: n }, () => post(theme, type, engagement, er));
}

describe("generateFindings — top-combo confidence", () => {
  it("labels a thin-sample winning combo as a Note, not a Strength", () => {
    // Recipes×reel wins on per-post engagement but only has 4 posts; the rest
    // give us a baseline. With volume below the confidence floor, the finding
    // must NOT be a green 'Strength'.
    const posts = [
      ...group("Recipes", "reel", 4, 200, 0.18),
      ...group("Education", "static", 6, 50, 0.04),
      ...group("Product", "static", 6, 40, 0.03),
    ];
    const findings = generateFindings(posts);
    const combo = findings.find((f) => f.id === "top-combo");
    expect(combo).toBeDefined();
    expect(combo!.severity).toBe("neutral");
    // The caveat names the small sample explicitly.
    expect(combo!.detail.toLowerCase()).toMatch(/early|only 4 posts|low confidence/);
  });

  it("keeps a well-sampled winning combo as a Strength", () => {
    // Recipes×reel wins AND has a healthy sample (6 posts).
    const posts = [
      ...group("Recipes", "reel", 6, 200, 0.18),
      ...group("Education", "static", 6, 50, 0.04),
      ...group("Product", "static", 6, 40, 0.03),
    ];
    const findings = generateFindings(posts);
    const combo = findings.find((f) => f.id === "top-combo");
    expect(combo).toBeDefined();
    expect(combo!.severity).toBe("positive");
  });
});
