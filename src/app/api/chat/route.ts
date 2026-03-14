import { NextResponse } from "next/server";
import { getAllDashboardData } from "@/lib/airtable";
import { num, str } from "@/lib/utils";

export async function POST(request: Request) {
  // Auth is enforced by middleware for all /api/* except /api/auth

  let body: { message?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { message, history } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "No message" }, { status: 400 });
  }

  if (message.length > 4000) {
    return NextResponse.json(
      { error: "Message too long (max 4000 characters)" },
      { status: 400 },
    );
  }

  // Validate and sanitise conversation history (max 10 messages)
  const validRoles = new Set(["user", "assistant"]);
  const conversationHistory: Array<{ role: string; content: string }> = [];
  if (Array.isArray(history)) {
    for (const msg of history.slice(-10)) {
      if (
        msg &&
        typeof msg === "object" &&
        typeof msg.role === "string" &&
        validRoles.has(msg.role) &&
        typeof msg.content === "string" &&
        msg.content.length <= 4000
      ) {
        conversationHistory.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Chat not configured" }, { status: 500 });
  }

  try {
    const data = await getAllDashboardData();

    // Detect active platforms
    const platformSet = new Set<string>();
    for (const r of data.dailyMetrics) {
      const p = str(r.fields["Platform"]).toLowerCase().trim();
      if (p) platformSet.add(p);
    }
    const platformCount = Math.max(platformSet.size, 1);

    // Last 14 days of daily metrics (14 days x N platforms)
    const recentDaily = data.dailyMetrics
      .map((r) => r.fields)
      .slice(0, 14 * platformCount);

    // Last 50 posts with metrics
    const recentPosts = data.posts.slice(0, 50).map((r) => r.fields);

    // Recent alerts
    const recentAlerts = data.alerts.slice(0, 20).map((r) => r.fields);

    // Platform follower counts (latest per platform)
    const platformLines: string[] = [];
    const seen = new Set<string>();
    for (const r of data.dailyMetrics) {
      const p = str(r.fields["Platform"]).toLowerCase().trim();
      if (!p || seen.has(p)) continue;
      seen.add(p);
      const followers = num(r.fields["Followers"]);
      const label = p.charAt(0).toUpperCase() + p.slice(1);
      platformLines.push(`- ${label}: ${followers} followers`);
    }

    const context = `You are an expert social media analyst for Bootle, a Swedish modular drinkware brand.
You have access to the latest organic social media performance data across ${Array.from(
      platformSet,
    )
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(", ")}.

PLATFORM OVERVIEW:
${platformLines.join("\n")}

Bootle's target audience is "The Conscious Explorer" — young, active urbanites who are sustainability-minded.
Key content themes: modular drinkware, sustainability, Scandinavian design, active lifestyle.

DAILY ACCOUNT METRICS (last 14 days, all platforms):
${JSON.stringify(recentDaily, null, 2)}

RECENT POSTS (last 50):
${JSON.stringify(recentPosts, null, 2)}

RECENT ALERTS:
${JSON.stringify(recentAlerts, null, 2)}

Answer the user's question concisely. Use specific numbers from the data. If recommending actions, be specific and actionable.
Focus on engagement rate trends, content performance patterns, follower growth, and platform comparison.
Industry benchmarks for reference: Instagram avg ER 1-3%, Facebook avg ER 0.5-1.5%, Pinterest avg ER 0.2-1%, TikTok avg ER 3-9%, YouTube avg ER 1-3%.`;

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
        messages: [...conversationHistory, { role: "user", content: message }],
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
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 },
    );
  }
}
