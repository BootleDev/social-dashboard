import { describe, it, expect } from "vitest";
import {
  formatLocalDate,
  formatLocalDateTime,
  dayOfWeekLocal,
  hourOfDayLocal,
} from "../utils";

// A reference instant: 2026-05-26T20:00:00Z (Tuesday 20:00 UTC).
// At that moment:
//   UTC               → Tue 20:00 (hour 20)
//   Europe/London     → Tue 21:00 BST (hour 21)
//   America/New_York  → Tue 16:00 EDT (hour 16)
//   America/Los_Angeles → Tue 13:00 PDT (hour 13)
const ISO = "2026-05-26T20:00:00Z";

describe("formatLocalDate", () => {
  it("formats UTC", () => {
    expect(formatLocalDate(ISO, "UTC")).toBe("2026-05-26");
  });
  it("formats London (BST=UTC+1)", () => {
    // 20:00 UTC = 21:00 BST, still 2026-05-26
    expect(formatLocalDate(ISO, "Europe/London")).toBe("2026-05-26");
  });
  it("formats LA (PDT=UTC-7), same day", () => {
    // 20:00 UTC = 13:00 PDT, still 2026-05-26
    expect(formatLocalDate(ISO, "America/Los_Angeles")).toBe("2026-05-26");
  });
  it("returns empty for invalid input", () => {
    expect(formatLocalDate("not-a-date", "UTC")).toBe("");
  });
});

describe("formatLocalDateTime", () => {
  it("formats UTC", () => {
    expect(formatLocalDateTime(ISO, "UTC")).toBe("2026-05-26 20:00");
  });
  it("formats London BST", () => {
    expect(formatLocalDateTime(ISO, "Europe/London")).toBe("2026-05-26 21:00");
  });
  it("formats LA PDT", () => {
    expect(formatLocalDateTime(ISO, "America/Los_Angeles")).toBe(
      "2026-05-26 13:00",
    );
  });
});

describe("dayOfWeekLocal", () => {
  it("returns Tue for UTC", () => {
    expect(dayOfWeekLocal(ISO, "UTC")).toBe("Tue");
  });
  it("returns Tue for LA (even though it's earlier same day)", () => {
    expect(dayOfWeekLocal(ISO, "America/Los_Angeles")).toBe("Tue");
  });
  it("handles a Saturday at 23:30 UTC that's Sunday in Tokyo", () => {
    // 2026-05-30T23:30:00Z is Sat in UTC, Sun in Asia/Tokyo (UTC+9 → 08:30 Sun)
    expect(dayOfWeekLocal("2026-05-30T23:30:00Z", "UTC")).toBe("Sat");
    expect(dayOfWeekLocal("2026-05-30T23:30:00Z", "Asia/Tokyo")).toBe("Sun");
  });
});

describe("hourOfDayLocal", () => {
  it("returns 20 for UTC", () => {
    expect(hourOfDayLocal(ISO, "UTC")).toBe(20);
  });
  it("returns 21 for London BST", () => {
    expect(hourOfDayLocal(ISO, "Europe/London")).toBe(21);
  });
  it("returns 16 for NY EDT", () => {
    expect(hourOfDayLocal(ISO, "America/New_York")).toBe(16);
  });
  it("returns 13 for LA PDT", () => {
    expect(hourOfDayLocal(ISO, "America/Los_Angeles")).toBe(13);
  });
  it("returns -1 for invalid input", () => {
    expect(hourOfDayLocal("not-a-date", "UTC")).toBe(-1);
  });
});
