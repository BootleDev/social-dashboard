import { NextResponse } from "next/server";
import { getContentLibrary } from "@/lib/airtable";

export async function GET() {
  // Auth is enforced by middleware for all /api/* except /api/auth
  try {
    const records = await getContentLibrary();
    return NextResponse.json({ records });
  } catch (err) {
    console.error("Competitors API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch competitor data" },
      { status: 500 },
    );
  }
}
