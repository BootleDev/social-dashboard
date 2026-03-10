import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getAllDashboardData,
  getPosts,
  getDailyAccountMetrics,
  getWeeklySummaries,
  getSocialAlerts,
} from "@/lib/airtable";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (cookieStore.get("bootle_social_auth")?.value !== "authenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
