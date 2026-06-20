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
  // OPERATIONS-90: the chat route now sources account-grain daily metrics from
  // accountDailyFacts (canonical, complete Reach/ER). dailyMetrics (legacy) is
  // only the fallback when accountDailyFacts is empty/absent.
  accountDailyFacts: [
    {
      id: "instagram|2026-03-10",
      fields: {
        Platform: "Instagram",
        Followers: 682,
        Date: "2026-03-10",
        Reach: 1200,
        "Engagement Rate": 0.086,
      },
      createdTime: "2026-03-10",
    },
    {
      id: "facebook|2026-03-10",
      fields: {
        Platform: "Facebook",
        Followers: 78,
        Date: "2026-03-10",
        Reach: 340,
        "Engagement Rate": 0.012,
      },
      createdTime: "2026-03-10",
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

  // OPERATIONS-90: the chat route must source account-grain daily metrics from
  // accountDailyFacts (canonical, complete Reach/ER), not the legacy NULL-prone
  // Daily Account Metrics. These tests capture the prompt sent to Anthropic and
  // assert the canonical values reach it, with legacy as fallback only.
  function captureAnthropicSystemPrompt() {
    const captured = { system: "" };
    globalThis.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (typeof url === "string" && url.includes("anthropic")) {
          captured.system = JSON.parse(String(init?.body)).system as string;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ content: [{ text: "ok" }] }),
          });
        }
        return originalFetch(url);
      });
    return captured;
  }

  it("sources daily metrics from accountDailyFacts (canonical Reach/ER)", async () => {
    const captured = captureAnthropicSystemPrompt();

    const res = await POST(makeRequest({ message: "how's reach?" }));
    expect(res.status).toBe(200);

    // The canonical Account Daily Facts reach values reach the prompt; the legacy
    // dailyMetrics rows (which carry no Reach key) do not source this section.
    expect(captured.system).toContain('"Reach": 1200');
    expect(captured.system).toContain('"Reach": 340');
    expect(captured.system).toContain('"Engagement Rate": 0.086');

    globalThis.fetch = originalFetch;
  });

  it("falls back to legacy dailyMetrics when accountDailyFacts is empty", async () => {
    mockGetAllDashboardData.mockResolvedValue({
      ...mockDashboardData,
      accountDailyFacts: [],
    });
    const captured = captureAnthropicSystemPrompt();

    const res = await POST(makeRequest({ message: "platforms?" }));
    expect(res.status).toBe(200);

    // Fallback path: legacy rows (no Reach key) feed the prompt, and the platform
    // overview still resolves Instagram + Facebook from the legacy followers.
    expect(captured.system).toContain("Instagram: 682 followers");
    expect(captured.system).toContain("Facebook: 78 followers");
    expect(captured.system).not.toContain('"Reach": 1200');

    globalThis.fetch = originalFetch;
  });
});
