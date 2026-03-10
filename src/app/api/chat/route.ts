import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAllDashboardData } from "@/lib/airtable";
import { num, str } from "@/lib/utils";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (cookieStore.get("bootle_social_auth")?.value !== "authenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { message } = await request.json();

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "No message" }, { status: 400 });
  }

  if (message.length > 4000) {
    return NextResponse.json(
      { error: "Message too long (max 4000 characters)" },
      { status: 400 },
    );
  }

  try {
    const data = await getAllDashboardData();

    // Last 14 days of daily metrics
    const recentDaily = data.dailyMetrics
      .map((r) => r.fields)
      .slice(0, 28); // 14 days x 2 platforms

    // Last 50 posts with metrics
    const recentPosts = data.posts
      .slice(0, 50)
      .map((r) => r.fields);

    // Recent alerts
    const recentAlerts = data.alerts
      .slice(0, 20)
      .map((r) => r.fields);

    // Platform follower counts (latest)
    const latestIG = data.dailyMetrics.find(
      (r) => str(r.fields["Platform"]).toLowerCase() === "instagram",
    );
    const latestFB = data.dailyMetrics.find(
      (r) => str(r.fields["Platform"]).toLowerCase() === "facebook",
    );

    const igFollowers = latestIG ? num(latestIG.fields["Followers"]) : "unknown";
    const fbFollowers = latestFB ? num(latestFB.fields["Followers"]) : "unknown";

    const context = `You are an expert social media analyst for Bootle, a Swedish modular drinkware brand.
You have access to the latest organic social media performance data across Instagram and Facebook.

PLATFORM OVERVIEW:
- Instagram: @bootleofficial, ${igFollowers} followers
- Facebook: Bootle, ${fbFollowers} followers

Bootle's target audience is "The Conscious Explorer" — young, active urbanites who are sustainability-minded.
Key content themes: modular drinkware, sustainability, Scandinavian design, active lifestyle.

DAILY ACCOUNT METRICS (last 14 days, both platforms):
${JSON.stringify(recentDaily, null, 2)}

RECENT POSTS (last 50):
${JSON.stringify(recentPosts, null, 2)}

RECENT ALERTS:
${JSON.stringify(recentAlerts, null, 2)}

Answer the user's question concisely. Use specific numbers from the data. If recommending actions, be specific and actionable.
Focus on engagement rate trends, content performance patterns, follower growth, and platform comparison.
Industry benchmarks for reference: Instagram avg ER 1-3%, Facebook avg ER 0.5-1.5%.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: context,
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errText}`);
    }

    const result = await res.json();
    const reply = result.content[0]?.text || "No response";

    return NextResponse.json({ reply });
  } catch (err) {
    const message_ = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message_ }, { status: 500 });
  }
}
