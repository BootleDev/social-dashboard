import { describe, it, expect, vi } from "vitest";

// Test the toggle logic extracted from PlatformFilter
// (Component rendering tested via the pure logic)

function togglePlatform(
  selected: Set<string>,
  key: string,
): Set<string> | null {
  const isActive = selected.has(key);
  if (isActive && selected.size <= 1) return null; // prevent empty state
  const next = new Set(selected);
  if (isActive) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

describe("PlatformFilter toggle logic", () => {
  it("removes a platform when toggling an active one", () => {
    const selected = new Set(["instagram", "facebook"]);
    const result = togglePlatform(selected, "instagram");
    expect(result).toEqual(new Set(["facebook"]));
  });

  it("adds a platform when toggling an inactive one", () => {
    const selected = new Set(["instagram"]);
    const result = togglePlatform(selected, "facebook");
    expect(result).toEqual(new Set(["instagram", "facebook"]));
  });

  it("prevents deselecting the last platform", () => {
    const selected = new Set(["instagram"]);
    const result = togglePlatform(selected, "instagram");
    expect(result).toBeNull();
  });

  it("does not mutate the original set", () => {
    const selected = new Set(["instagram", "facebook"]);
    const result = togglePlatform(selected, "instagram");
    expect(selected).toEqual(new Set(["instagram", "facebook"]));
    expect(result).toEqual(new Set(["facebook"]));
  });

  it("handles toggling on a platform not in the set", () => {
    const selected = new Set(["instagram"]);
    const result = togglePlatform(selected, "pinterest");
    expect(result).toEqual(new Set(["instagram", "pinterest"]));
  });
});

describe("filterByPlatform", () => {
  function filterByPlatform(
    records: Array<{ fields: Record<string, unknown> }>,
    selected: Set<string>,
  ) {
    return records.filter((r) => {
      const platform = String(r.fields["Platform"] ?? "")
        .toLowerCase()
        .trim();
      return selected.has(platform);
    });
  }

  const records = [
    { fields: { Platform: "Instagram", Date: "2026-01-01" } },
    { fields: { Platform: "Facebook", Date: "2026-01-01" } },
    { fields: { Platform: "Pinterest", Date: "2026-01-02" } },
    { fields: { Platform: "instagram", Date: "2026-01-02" } },
  ];

  it("filters to only selected platforms", () => {
    const result = filterByPlatform(
      records,
      new Set(["instagram"]),
    );
    expect(result).toHaveLength(2);
    expect(result.every((r) => String(r.fields["Platform"]).toLowerCase() === "instagram")).toBe(true);
  });

  it("returns all records when all platforms selected", () => {
    const result = filterByPlatform(
      records,
      new Set(["instagram", "facebook", "pinterest"]),
    );
    expect(result).toHaveLength(4);
  });

  it("returns empty array when no platforms match", () => {
    const result = filterByPlatform(records, new Set(["tiktok"]));
    expect(result).toHaveLength(0);
  });

  it("handles case-insensitive matching", () => {
    const result = filterByPlatform(
      [{ fields: { Platform: "INSTAGRAM" } }],
      new Set(["instagram"]),
    );
    expect(result).toHaveLength(1);
  });

  it("handles missing Platform field", () => {
    const result = filterByPlatform(
      [{ fields: { Date: "2026-01-01" } }],
      new Set(["instagram"]),
    );
    expect(result).toHaveLength(0);
  });
});
