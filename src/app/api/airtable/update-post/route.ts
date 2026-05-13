import { NextResponse } from "next/server";
import { TABLES } from "@/lib/airtable";

const BASE_URL = "https://api.airtable.com/v0";

// Whitelist of fields that can be written via this endpoint.
// Never accept arbitrary field names from the client.
const ALLOWED_FIELDS = new Set([
  "Hook Present",
  "Hook Type",
  "Hook Text",
  "VO Type",
  "CTA Type",
  "On-Screen Text",
  "Visual Style",
  "Setting",
  "Content Pillar",
  "Talent Present",
  "Tagging Status",
]);

// Simple in-memory rate limiter: max 10 requests per session token per minute.
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(sessionId);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(sessionId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  rateLimiter.set(sessionId, { ...entry, count: entry.count + 1 });
  return true;
}

export async function POST(request: Request) {
  // Use the session cookie value as a rate-limit key (falls back to IP header)
  const sessionId =
    request.headers.get("cookie")?.match(/session=([^;]+)/)?.[1] ??
    request.headers.get("x-forwarded-for") ??
    "anonymous";

  if (!checkRateLimit(sessionId)) {
    return NextResponse.json(
      { error: "Too many requests. Retry in a minute." },
      { status: 429 },
    );
  }

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!baseId || !apiKey) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).id !== "string" ||
    typeof (body as Record<string, unknown>).fields !== "object"
  ) {
    return NextResponse.json(
      { error: "Body must be { id: string, fields: object }" },
      { status: 400 },
    );
  }

  const { id, fields } = body as { id: string; fields: Record<string, unknown> };

  // Reject any field not in the whitelist
  const disallowed = Object.keys(fields).filter((k) => !ALLOWED_FIELDS.has(k));
  if (disallowed.length > 0) {
    return NextResponse.json(
      { error: `Field(s) not allowed: ${disallowed.join(", ")}` },
      { status: 400 },
    );
  }

  const url = `${BASE_URL}/${baseId}/${TABLES.POSTS}/${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Airtable error: ${text}` },
      { status: res.status },
    );
  }

  const updated = await res.json();
  return NextResponse.json({ record: updated });
}
