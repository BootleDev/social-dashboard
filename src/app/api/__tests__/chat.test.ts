import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAllDashboardData = vi.fn();

vi.mock("@/lib/airtable", () => ({
  getAllDashboardData: () => mockGetAllDashboardData(),
}));

// Mock global fetch for Anthropic API calls
const originalFetch = globalThis.fetch;

import { POST } from "../chat/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockDashboardData = {
  posts: [
    {
      id: "rec1",
      fields: { Platform: "Instagram", Caption: "Test", "Engagement Rate": 5 },
      createdTime: "2026-01-01",
    },
  ],
  dailyMetrics: [
    {
      id: "rec2",
      fields: { Platform: "Instagram", Followers: 682, Date: "2026-03-10" },
      createdTime: "2026-03-10",
    },
    {
      id: "rec3",
      fields: { Platform: "Facebook", Followers: 78, Date: "2026-03-10" },
      createdTime: "2026-03-10",
    },
  ],
  weeklySummaries: [],
  alerts: [],
};

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllDashboardData.mockResolvedValue(mockDashboardData);
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when message is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("No message");
  });

  it("returns 400 when message is not a string", async () => {
    const res = await POST(makeRequest({ message: 123 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when message exceeds 4000 chars", async () => {
    const res = await POST(makeRequest({ message: "a".repeat(4001) }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("4000");
  });

  it("returns 500 when ANTHROPIC_API_KEY not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(makeRequest({ message: "hello" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Chat not configured");
  });

  it("validates history messages", async () => {
    // Mock fetch for the Anthropic API
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("anthropic")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ content: [{ text: "Test reply" }] }),
        });
      }
      return originalFetch(url);
    });

    const res = await POST(
      makeRequest({
        message: "hello",
        history: [
          { role: "user", content: "first msg" },
          { role: "invalid_role", content: "bad" }, // should be filtered
          { role: "assistant", content: "reply" },
        ],
      }),
    );
    expect(res.status).toBe(200);

    globalThis.fetch = originalFetch;
  });

  it("returns 500 on Anthropic API failure", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("anthropic")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal error"),
        });
      }
      return originalFetch(url);
    });

    const res = await POST(makeRequest({ message: "hello" }));
    expect(res.status).toBe(500);

    globalThis.fetch = originalFetch;
  });
});
