import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth module before importing the route
vi.mock("@/lib/auth", () => ({
  createAuthToken: vi.fn().mockResolvedValue("mock-token-hex"),
  checkRateLimit: vi.fn().mockReturnValue(true),
}));

import { POST } from "../auth/route";
import { checkRateLimit } from "@/lib/auth";

function makeRequest(body: unknown, ip = "127.0.0.1"): Request {
  return new Request("http://localhost/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (checkRateLimit as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it("returns 500 when DASHBOARD_PASSWORD not set", async () => {
    const original = process.env.DASHBOARD_PASSWORD;
    delete process.env.DASHBOARD_PASSWORD;
    const res = await POST(makeRequest({ password: "test" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Server misconfigured");
    process.env.DASHBOARD_PASSWORD = original;
  });

  it("returns 429 when rate limited", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    (checkRateLimit as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const res = await POST(makeRequest({ password: "secret" }));
    expect(res.status).toBe(429);
  });

  it("returns 400 for invalid JSON body", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const req = new Request("http://localhost/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 for wrong password", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const res = await POST(makeRequest({ password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 and sets cookie for correct password", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const res = await POST(makeRequest({ password: "secret" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("bootle_social_auth");
  });
});
