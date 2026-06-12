import "@testing-library/jest-dom";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BestTimeToPost from "../BestTimeToPost";
import type { AirtableRecord } from "@/lib/utils";

afterEach(cleanup);

/** A post published at a fixed UTC instant with a given reach + engagement. */
function post(
  id: string,
  publishedAtUTC: string,
  reach: number,
  engagement: number,
): AirtableRecord {
  return {
    id,
    fields: {
      "Post ID": id,
      Platform: "instagram",
      "Published At": publishedAtUTC,
      Reach: reach,
      Engagement: engagement,
      "Engagement Rate": reach > 0 ? engagement / reach : 0,
    },
    createdTime: publishedAtUTC,
  };
}

describe("BestTimeToPost — day-part default for low volume", () => {
  it("defaults to day-part columns and ranks a slot from a handful of posts", () => {
    // Five posts on Friday mornings (UTC, ~08:00) — in a 24-hour grid these
    // could scatter across hour columns, but as a day-part they pool into one
    // "Friday Morning" slot that clears the min-3 floor.
    const posts = [
      post("p1", "2026-05-01T08:00:00Z", 1000, 100), // Fri
      post("p2", "2026-05-08T08:30:00Z", 1000, 100), // Fri
      post("p3", "2026-05-15T09:00:00Z", 1000, 100), // Fri
      post("p4", "2026-05-22T07:30:00Z", 1000, 100), // Fri
      post("p5", "2026-05-29T09:30:00Z", 1000, 100), // Fri
    ];

    render(<BestTimeToPost posts={posts} timezone="UTC" />);

    // Day-part is the default granularity selection.
    const granularity = screen.getByLabelText(
      "Heatmap granularity",
    ) as HTMLSelectElement;
    expect(granularity.value).toBe("daypart");

    // The day-part column headers are present.
    expect(screen.getByText("Morning")).toBeInTheDocument();
    expect(screen.getByText("Evening")).toBeInTheDocument();

    // A real top slot is surfaced from just five posts (would be empty under a
    // 24-column grid with a min-5 floor).
    expect(screen.getByText(/Top slots/i)).toBeInTheDocument();
    expect(screen.getByText(/Fri Morning/i)).toBeInTheDocument();
  });
});
