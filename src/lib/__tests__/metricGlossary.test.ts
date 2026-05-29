import { describe, it, expect } from "vitest";
import {
  METRIC_GLOSSARY,
  tooltipText,
  glossaryFor,
} from "@/lib/metricGlossary";

describe("tooltipText", () => {
  it("appends the formula on a bullet line when present", () => {
    const text = tooltipText("vtr");
    expect(text).toContain("Video views / reach");
    expect(text).toContain("•");
    // definition comes before the bullet/formula
    expect(text!.indexOf("•")).toBeGreaterThan(0);
  });

  it("returns the bare definition when there is no formula", () => {
    const text = tooltipText("engagementScore");
    expect(text).toBe(METRIC_GLOSSARY.engagementScore.definition);
    expect(text).not.toContain("•");
  });

  it("returns undefined for an unknown key", () => {
    expect(tooltipText("not_a_metric")).toBeUndefined();
  });
});

describe("glossaryFor", () => {
  it("resolves a table SortField header to its definition", () => {
    expect(glossaryFor("Save Rate")).toBe(tooltipText("saveRate"));
  });

  it("resolves a full metric-selector label", () => {
    expect(glossaryFor("View-Through Rate")).toBe(tooltipText("vtr"));
  });

  it("resolves a bare abbreviation", () => {
    expect(glossaryFor("ER")).toBe(tooltipText("engagementRate"));
  });

  it("falls back to treating the label as a direct key", () => {
    expect(glossaryFor("vtr")).toBe(tooltipText("vtr"));
  });

  it("returns undefined for an unrecognised label", () => {
    expect(glossaryFor("Phase Of The Moon")).toBeUndefined();
  });

  it("covers every metric-selector label used by the table and slicers", () => {
    // These are the labels passed to glossaryFor() from the UI surfaces. If a
    // new metric is added to a selector, it should get a glossary entry too.
    const uiLabels = [
      "VTR",
      "Save Rate",
      "Engagement Rate",
      "Engagement Score",
      "Reach Score",
      "Skip Rate",
      "Reach",
      "Reposts",
      "Saves",
      "Shares",
      "Likes",
      "Video Views",
      "Link Clicks",
      "Comments",
      "View-Through Rate",
      "Comment Rate",
      "Share Rate",
      "Watch Time %",
    ];
    for (const label of uiLabels) {
      expect(glossaryFor(label), `missing glossary for "${label}"`).toBeDefined();
    }
  });
});
