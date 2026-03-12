import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPosts = vi.fn();
const mockGetDailyAccountMetrics = vi.fn();
const mockGetWeeklySummaries = vi.fn();
const mockGetSocialAlerts = vi.fn();
const mockGetAllDashboardData = vi.fn();

vi.mock("@/lib/airtable", () => ({
  getPosts: () => mockGetPosts(),
  getDailyAccountMetrics: () => mockGetDailyAccountMetrics(),
  getWeeklySummaries: () => mockGetWeeklySummaries(),
  getSocialAlerts: () => mockGetSocialAlerts(),
  getAllDashboardData: () => mockGetAllDashboardData(),
}));

import { GET } from "../airtable/route";

function makeRequest(params = ""): Request {
  return new Request(`http://localhost/api/airtable${params ? "?" + params : ""}`);
}

describe("GET /api/airtable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches posts when table=posts", async () => {
    mockGetPosts.mockResolvedValue([{ id: "1", fields: {} }]);
    const res = await GET(makeRequest("table=posts"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.records).toHaveLength(1);
  });

  it("fetches daily metrics when table=daily", async () => {
    mockGetDailyAccountMetrics.mockResolvedValue([]);
    const res = await GET(makeRequest("table=daily"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.records).toEqual([]);
  });

  it("fetches weekly summaries when table=weekly", async () => {
    mockGetWeeklySummaries.mockResolvedValue([]);
    const res = await GET(makeRequest("table=weekly"));
    expect(res.status).toBe(200);
  });

  it("fetches alerts when table=alerts", async () => {
    mockGetSocialAlerts.mockResolvedValue([]);
    const res = await GET(makeRequest("table=alerts"));
    expect(res.status).toBe(200);
  });

  it("fetches all data when no table param", async () => {
    mockGetAllDashboardData.mockResolvedValue({
      posts: [],
      dailyMetrics: [],
      weeklySummaries: [],
      alerts: [],
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("posts");
    expect(data).toHaveProperty("dailyMetrics");
  });

  it("returns 500 on fetch error", async () => {
    mockGetAllDashboardData.mockRejectedValue(new Error("Airtable down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to load data");
  });
});
