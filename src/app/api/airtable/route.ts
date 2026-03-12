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

  try {
    if (table === "posts") {
      const data = await getPosts();
      return NextResponse.json({ records: data });
    }
    if (table === "daily") {
      const data = await getDailyAccountMetrics();
      return NextResponse.json({ records: data });
    }
    if (table === "weekly") {
      const data = await getWeeklySummaries();
      return NextResponse.json({ records: data });
    }
    if (table === "alerts") {
      const data = await getSocialAlerts();
      return NextResponse.json({ records: data });
    }

    const data = await getAllDashboardData();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Airtable API error:", err);
    return NextResponse.json({ error: "Failed to load data" }, { status: 500 });
  }
}
