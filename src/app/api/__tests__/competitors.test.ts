import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetContentLibrary = vi.fn();

vi.mock("@/lib/airtable", () => ({
  getContentLibrary: () => mockGetContentLibrary(),
}));

import { GET } from "../competitors/route";

describe("GET /api/competitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns competitor records", async () => {
    mockGetContentLibrary.mockResolvedValue([
      { id: "rec1", fields: { Brand: "YETI", Views: 1000 } },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.records).toHaveLength(1);
    expect(data.records[0].fields.Brand).toBe("YETI");
  });

  it("returns 500 on fetch error", async () => {
    mockGetContentLibrary.mockRejectedValue(new Error("Network error"));
    const res = await GET();
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to fetch competitor data");
  });
});
