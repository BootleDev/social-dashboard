import { NextResponse } from "next/server";
import {
  getAllDashboardData,
  getPosts,
  getDailyAccountMetrics,
  getWeeklySummaries,
  getSocialAlerts,
} from "@/lib/airtable";

export async function GET(request: Request) {
  // Auth is enforced by middleware for all /api/* except /api/auth

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  // MARKETING-19 Fix 7: ?nocache=1 bypasses the 30-min fetch cache. The
  // dashboard's Refresh button passes this; normal page loads keep caching.
  const noCache = searchParams.get("nocache") === "1";

  try {
    if (table === "posts") {
      const data = await getPosts({ noCache });
      return NextResponse.json({ records: data });
    }
    if (table === "daily") {
      const data = await getDailyAccountMetrics({ noCache });
      return NextResponse.json({ records: data });
    }
    if (table === "weekly") {
      const data = await getWeeklySummaries({ noCache });
      return NextResponse.json({ records: data });
    }
    if (table === "alerts") {
      const data = await getSocialAlerts({ noCache });
      return NextResponse.json({ records: data });
    }

    const data = await getAllDashboardData({ noCache });
    return NextResponse.json(data);
  } catch (err) {
    console.error("Airtable API error:", err);
    return NextResponse.json({ error: "Failed to load data" }, { status: 500 });
  }
}
