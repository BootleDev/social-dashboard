/**
 * Auth token utilities using HMAC-SHA256.
 * Uses Web Crypto API (works in both Edge and Node runtimes).
 */

const SIGNING_CONTEXT = "bootle_social_dashboard_v1";

async function hmacSign(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(data),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createAuthToken(password: string): Promise<string> {
  return hmacSign(password, SIGNING_CONTEXT);
}

export async function verifyAuthToken(
  token: string,
  password: string,
): Promise<boolean> {
  if (!token || !password) return false;
  const expected = await createAuthToken(password);
  // Constant-time comparison
  if (token.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Simple in-memory rate limiter. */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  ip: string,
  maxAttempts = 5,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) return false;
  attempts.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
  return true;
}
