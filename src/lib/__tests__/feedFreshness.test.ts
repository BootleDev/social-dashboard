import { describe, it, expect } from "vitest";
import {
  latestDateInField,
  feedStatus,
  buildFeedHealth,
  type FeedSpec,
} from "../feedFreshness";
import type { AirtableRecord } from "../utils";

function rec(fields: Record<string, unknown>): AirtableRecord {
  return { id: `rec_${Math.random()}`, createdTime: "", fields };
}

describe("latestDateInField", () => {
  it("returns the max yyyy-mm-dd across records", () => {
    const recs = [
      rec({ Date: "2026-06-01" }),
      rec({ Date: "2026-06-05T12:00:00Z" }),
      rec({ Date: "2026-05-20" }),
    ];
    expect(latestDateInField(recs, "Date")).toBe("2026-06-05");
  });

  it("ignores empty/missing values", () => {
    const recs = [rec({ Date: "" }), rec({ Other: "x" }), rec({ Date: "2026-06-03" })];
    expect(latestDateInField(recs, "Date")).toBe("2026-06-03");
  });

  it("returns null when no record has the field", () => {
    expect(latestDateInField([rec({ Other: "x" })], "Date")).toBeNull();
  });

  it("returns null for an empty record set", () => {
    expect(latestDateInField([], "Date")).toBeNull();
  });
});

describe("feedStatus", () => {
  const today = "2026-06-05";

  it("is 'fresh' when the last date is within the staleness window", () => {
    expect(feedStatus("2026-06-05", today, 2)).toBe("fresh");
    expect(feedStatus("2026-06-04", today, 2)).toBe("fresh");
  });

  it("is 'stale' when the last date is older than the window", () => {
    expect(feedStatus("2026-06-01", today, 2)).toBe("stale");
  });

  it("is 'empty' when there is no last date", () => {
    expect(feedStatus(null, today, 2)).toBe("empty");
  });

  it("treats the boundary day as fresh (inclusive window)", () => {
    // window 2 days → 06-03 is exactly 2 days behind 06-05, still fresh.
    expect(feedStatus("2026-06-03", today, 2)).toBe("fresh");
    expect(feedStatus("2026-06-02", today, 2)).toBe("stale");
  });
});

describe("buildFeedHealth", () => {
  const today = "2026-06-05";
  const specs: FeedSpec[] = [
    { key: "posts", label: "Posts", dateField: "Published At", maxAgeDays: 4 },
    { key: "alerts", label: "Alerts", dateField: "Alert Date", maxAgeDays: 3 },
    {
      key: "seasonal",
      label: "Seasonal opportunities",
      dateField: "",
      maxAgeDays: 0,
      reference: true,
    },
  ];

  it("computes a status row per spec", () => {
    const data = {
      posts: [rec({ "Published At": "2026-06-02" })],
      alerts: [rec({ "Alert Date": "2026-06-05" })],
      seasonal: [rec({ Name: "Summer" })],
    };
    const rows = buildFeedHealth(specs, data, today);
    expect(rows).toHaveLength(3);

    const posts = rows.find((r) => r.key === "posts")!;
    expect(posts.lastDate).toBe("2026-06-02");
    expect(posts.status).toBe("fresh"); // within 4 days

    const alerts = rows.find((r) => r.key === "alerts")!;
    expect(alerts.status).toBe("fresh");

    // Reference feeds are never flagged stale; they report record count only.
    const seasonal = rows.find((r) => r.key === "seasonal")!;
    expect(seasonal.status).toBe("reference");
    expect(seasonal.recordCount).toBe(1);
  });

  it("marks a feed with no records as empty", () => {
    const rows = buildFeedHealth(specs, { posts: [], alerts: [], seasonal: [] }, today);
    expect(rows.find((r) => r.key === "posts")!.status).toBe("empty");
  });

  it("marks an out-of-window feed as stale", () => {
    const data = {
      posts: [rec({ "Published At": "2026-05-01" })],
      alerts: [rec({ "Alert Date": "2026-06-05" })],
      seasonal: [rec({ Name: "x" })],
    };
    expect(buildFeedHealth(specs, data, today).find((r) => r.key === "posts")!.status).toBe(
      "stale",
    );
  });

  it("counts records per feed", () => {
    const data = {
      posts: [rec({ "Published At": "2026-06-05" }), rec({ "Published At": "2026-06-04" })],
      alerts: [],
      seasonal: [],
    };
    expect(buildFeedHealth(specs, data, today).find((r) => r.key === "posts")!.recordCount).toBe(
      2,
    );
  });
});
