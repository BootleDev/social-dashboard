import { describe, it, expect } from "vitest";
import {
  getPlatformConfig,
  platformSortOrder,
} from "../platforms";

describe("getPlatformConfig", () => {
  it("returns config for known platform", () => {
    const config = getPlatformConfig("instagram");
    expect(config.label).toBe("Instagram");
    expect(config.color).toBe("#a855f7");
    expect(config.key).toBe("instagram");
  });

  it("is case-insensitive", () => {
    const config = getPlatformConfig("FACEBOOK");
    expect(config.label).toBe("Facebook");
    expect(config.color).toBe("#3b82f6");
  });

  it("handles mixed case with whitespace", () => {
    const config = getPlatformConfig("  Pinterest ");
    expect(config.label).toBe("Pinterest");
    expect(config.color).toBe("#e60023");
  });

  it("returns all known platforms correctly", () => {
    const platforms = ["instagram", "facebook", "pinterest", "tiktok", "youtube"];
    for (const p of platforms) {
      const config = getPlatformConfig(p);
      expect(config.key).toBe(p);
      expect(config.label).toBeTruthy();
      expect(config.color).toMatch(/^#/);
      expect(config.colorBg).toBeTruthy();
      expect(config.colorFill).toBeTruthy();
    }
  });

  it("returns fallback config for unknown platform", () => {
    const config = getPlatformConfig("mastodon");
    expect(config.key).toBe("mastodon");
    expect(config.label).toBe("Mastodon");
    expect(config.color).toMatch(/^#/);
    expect(config.colorBg).toBeTruthy();
    expect(config.colorFill).toBeTruthy();
  });

  it("capitalizes unknown platform label", () => {
    const config = getPlatformConfig("threads");
    expect(config.label).toBe("Threads");
  });

  it("returns consistent fallback for same unknown key", () => {
    const a = getPlatformConfig("bluesky");
    const b = getPlatformConfig("bluesky");
    expect(a.color).toBe(b.color);
  });
});

describe("platformSortOrder", () => {
  it("returns correct order for known platforms", () => {
    expect(platformSortOrder("instagram")).toBe(0);
    expect(platformSortOrder("facebook")).toBe(1);
    expect(platformSortOrder("pinterest")).toBe(2);
    expect(platformSortOrder("tiktok")).toBe(3);
    expect(platformSortOrder("youtube")).toBe(4);
  });

  it("is case-insensitive", () => {
    expect(platformSortOrder("INSTAGRAM")).toBe(0);
  });

  it("returns 99 for unknown platforms", () => {
    expect(platformSortOrder("mastodon")).toBe(99);
  });
});
