import "@testing-library/jest-dom";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NeedsAttention from "../NeedsAttention";
import type { AirtableRecord } from "@/lib/utils";

afterEach(cleanup);

/** A real per-day account-reach fact row for `platform` on `date`. */
function reachFact(
  platform: string,
  date: string,
  reach: number,
): AirtableRecord {
  return {
    id: `fact_${platform}_${date}`,
    fields: {
      Platform: platform,
      Date: date,
      Reach: reach,
      "Reach Source": "daily_real",
    },
    createdTime: `${date}T00:00:00.000Z`,
  };
}

/** N consecutive daily fact rows starting at `startDay` (May), each `reach`. */
function reachDays(
  platform: string,
  startDay: number,
  count: number,
  reach: number,
): AirtableRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const day = String(startDay + i).padStart(2, "0");
    return reachFact(platform, `2026-05-${day}`, reach);
  });
}

describe("NeedsAttention — biggest-mover percentage guard", () => {
  it("does NOT surface a move when prior coverage is sparse vs current", () => {
    // The real 3545% bug: current window densely measured (8 days), prior
    // window only 2 measured days. A sum-vs-sum ratio explodes; the coverage
    // guard must suppress it entirely.
    const dailyMetrics = reachDays("instagram", 10, 8, 200); // 8 days
    const prevDailyMetrics = reachDays("instagram", 1, 2, 67); // 2 days

    render(
      <NeedsAttention
        posts={[]}
        prevPosts={[]}
        dailyMetrics={dailyMetrics}
        prevDailyMetrics={prevDailyMetrics}
        alerts={[]}
        onSelectPost={vi.fn()}
      />,
    );

    // No mover line at all — coverage too lopsided to compare.
    expect(screen.queryByText(/reach (up|down) \d/i)).toBeNull();
    // And specifically no explosive percentage.
    expect(screen.queryByText(/\d{3,}%/)).toBeNull();
  });

  it("DOES surface a real mover when coverage is comparable", () => {
    // Both windows 8 measured days; avg/day 200 now vs 100 prior = +100%.
    const dailyMetrics = reachDays("instagram", 10, 8, 200);
    const prevDailyMetrics = reachDays("instagram", 1, 8, 100);

    render(
      <NeedsAttention
        posts={[]}
        prevPosts={[]}
        dailyMetrics={dailyMetrics}
        prevDailyMetrics={prevDailyMetrics}
        alerts={[]}
        onSelectPost={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/reach up 100% vs prior period/i),
    ).toBeInTheDocument();
  });

  it("does NOT surface a trivial per-day move", () => {
    // avg 102/day vs 100/day over comparable coverage — below the relative floor.
    const dailyMetrics = reachDays("instagram", 10, 8, 102);
    const prevDailyMetrics = reachDays("instagram", 1, 8, 100);

    render(
      <NeedsAttention
        posts={[]}
        prevPosts={[]}
        dailyMetrics={dailyMetrics}
        prevDailyMetrics={prevDailyMetrics}
        alerts={[]}
        onSelectPost={vi.fn()}
      />,
    );

    expect(screen.queryByText(/reach (up|down) \d/i)).toBeNull();
  });
});
