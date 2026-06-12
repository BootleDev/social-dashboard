import { NextResponse } from "next/server";
import { updatePostRecord } from "@/lib/airtable";

/**
 * Whitelist of post fields the drilldown editor is allowed to write.
 * Anything outside this list is rejected at the API boundary so a stray
 * client-side mistake can't accidentally clobber metrics, captions, or
 * snapshot timestamps.
 */
const EDITABLE_FIELDS = new Set<string>([
  "Hook Type",
  "Content Theme",
  "Content Pillar",
  "CTA Type",
  "Visual Style",
  "Setting",
  "VO Type",
]);

type PostsPatchBody = {
  fields?: Record<string, unknown>;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || typeof id !== "string" || !id.startsWith("rec")) {
    return NextResponse.json(
      { error: "Invalid record id" },
      { status: 400 },
    );
  }

  let body: PostsPatchBody;
  try {
    body = (await request.json()) as PostsPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fields = body.fields;
  if (!fields || typeof fields !== "object") {
    return NextResponse.json(
      { error: "Missing 'fields' object" },
      { status: 400 },
    );
  }

  // Reject any field not on the editable whitelist. Pin the keys and
  // re-build the object so callers can't smuggle anything past us by
  // adding extra properties.
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!EDITABLE_FIELDS.has(key)) {
      return NextResponse.json(
        { error: `Field '${key}' is not editable` },
        { status: 403 },
      );
    }
    // Accept string values only (single-select choice names or free text);
    // empty string clears the value.
    if (typeof value !== "string" && value !== null) {
      return NextResponse.json(
        { error: `Field '${key}' must be a string or null` },
        { status: 400 },
      );
    }
    sanitized[key] = value === "" ? null : value;
  }

  if (Object.keys(sanitized).length === 0) {
    return NextResponse.json(
      { error: "No editable fields supplied" },
      { status: 400 },
    );
  }

  try {
    const updated = await updatePostRecord(id, sanitized);
    return NextResponse.json({ record: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[posts PATCH]", message);
    return NextResponse.json(
      { error: "Update failed", detail: message },
      { status: 500 },
    );
  }
}
