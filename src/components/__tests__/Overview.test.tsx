import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Overview from "../Overview";
import type { AirtableRecord } from "@/lib/utils";

// Charts need a real canvas; the grain-labeling behavior under test doesn't.
vi.mock("react-chartjs-2", () => ({
  Line: () => null,
  Bar: () => null,
}));
// Heavy children with their own data plumbing — out of scope here.
vi.mock("../TrendCharts", () => ({ default: () => null }));
vi.mock("../NeedsAttention", () => ({ default: () => null }));

let recId = 0;
function makeRecord(fields: Record<string, unknown>): AirtableRecord {
  return {
    id: `rec_${recId++}`,
    fields,
    createdTime: "2026-01-01T00:00:00.000Z",
  };
}

const posts = [
  makeRecord({
    Platform: "instagram",
    "Published At": "2026-06-01T10:00:00.000Z",
    Reach: 1000,
    Impressions: 1200,
    Engagement: 80,
    Likes: 60,
    Comments: 10,
    Saves: 8,
    Shares: 2,
  }),
  makeRecord({
    Platform: "pinterest",
    "Published At": "2026-06-02T10:00:00.000Z",
    Impressions: 500,
    Engagement: 12,
  }),
];

const dailyMetrics = [
  makeRecord({
    Platform: "Instagram",
    Date: "2026-06-01",
    Reach: 800,
    "Reach Source": "daily_real",
    "Impressions Source": "null",
    Followers: 600,
  }),
];

function renderOverview() {
  return render(
    <Overview
      posts={posts}
      dailyMetrics={dailyMetrics}
      alerts={[]}
      weeklySummaries={[]}
      prevPosts={[]}
      prevDailyMetrics={[]}
      onSelectPost={vi.fn()}
    />,
  );
}

describe("Overview metric grain labeling (WEBDEV-182)", () => {
  it("labels both north-star cards with an explicit post-level grain note", () => {
    renderOverview();
    expect(screen.getByText("Total Reach")).toBeTruthy();
    expect(
      screen.getAllByText("Total Engagement").length,
    ).toBeGreaterThanOrEqual(1);
    // One grain note per north-star card — a post-level sum must never be
    // presentable as account-level reach (metric-grain rule).
    expect(
      screen.getAllByText("post-level · summed across this window").length,
    ).toBe(2);
  });

  it("titles the KPI-row distribution cards at the post grain, never bare Reach/Impressions", () => {
    renderOverview();
    expect(screen.getByText("Post Reach")).toBeTruthy();
    expect(screen.getByText("Post Impressions")).toBeTruthy();
  });

  it("sums north-star reach at the post grain with the Pinterest substitution", () => {
    renderOverview();
    // 1000 (IG post reach) + 500 (Pinterest impressions-as-reach) = 1.5K
    expect(screen.getAllByText("1.5K").length).toBeGreaterThanOrEqual(1);
  });
});
