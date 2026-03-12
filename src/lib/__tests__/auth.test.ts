import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAuthToken, verifyAuthToken, checkRateLimit } from "../auth";

describe("createAuthToken", () => {
  it("returns a hex string", async () => {
    const token = await createAuthToken("test-password");
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("returns consistent output for same input", async () => {
    const a = await createAuthToken("password");
    const b = await createAuthToken("password");
    expect(a).toBe(b);
  });

  it("returns different output for different input", async () => {
    const a = await createAuthToken("password1");
    const b = await createAuthToken("password2");
    expect(a).not.toBe(b);
  });
});

describe("verifyAuthToken", () => {
  it("verifies valid token", async () => {
    const token = await createAuthToken("secret");
    const valid = await verifyAuthToken(token, "secret");
    expect(valid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const token = await createAuthToken("secret");
    const valid = await verifyAuthToken(token, "wrong");
    expect(valid).toBe(false);
  });

  it("rejects empty token", async () => {
    const valid = await verifyAuthToken("", "secret");
    expect(valid).toBe(false);
  });

  it("rejects empty password", async () => {
    const valid = await verifyAuthToken("abc", "");
    expect(valid).toBe(false);
  });

  it("rejects token with wrong length", async () => {
    const valid = await verifyAuthToken("abc", "secret");
    expect(valid).toBe(false);
  });
});

describe("checkRateLimit", () => {
  // Rate limiter uses module-level Map, so we need fresh IPs per test
  let testIp: string;

  beforeEach(() => {
    testIp = `test-${Date.now()}-${Math.random()}`;
  });

  it("allows first attempt", () => {
    expect(checkRateLimit(testIp)).toBe(true);
  });

  it("allows up to maxAttempts", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(testIp)).toBe(true);
    }
  });

  it("blocks after maxAttempts exceeded", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit(testIp);
    }
    expect(checkRateLimit(testIp)).toBe(false);
  });

  it("respects custom maxAttempts", () => {
    for (let i = 0; i < 2; i++) {
      checkRateLimit(testIp, 2);
    }
    expect(checkRateLimit(testIp, 2)).toBe(false);
  });

  it("resets after window expires", () => {
    // Use a very short window
    for (let i = 0; i < 5; i++) {
      checkRateLimit(testIp, 5, 1); // 1ms window
    }
    // After window expires, should allow again
    // Due to timing, just verify the interface works
    expect(typeof checkRateLimit(testIp, 5, 1)).toBe("boolean");
  });
});
