import { NextResponse } from "next/server";
import { getAllDashboardData } from "@/lib/airtable";
import { num, str } from "@/lib/utils";

export async function POST(request: Request) {
  // Auth is enforced by middleware for all /api/* except /api/auth

  let body: { message?: unknown; history?: unknown; pageContext?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { message, history, pageContext } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "No message" }, { status: 400 });
  }

  // Optional live context from the active tab (currently the Paid simulator),
  // so the assistant can reason about the exact scenario the user is viewing.
  // Bounded so a malformed client can't bloat the prompt.
  const activeContext =
    typeof pageContext === "string" && pageContext.length > 0
      ? pageContext.slice(0, 4000)
      : null;

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

    // OPERATIONS-90: source account-grain daily metrics from Account Daily Facts
    // (the canonical table, WEBDEV-146/228), not the legacy Daily Account Metrics
    // table. Account Daily Facts is the single source of truth for account KPIs:
    // its Reach is real/measured (daily_real for IG, daily_proxy for FB post
    // OPS-89, pin_sum for Pinterest) and its Engagement Rate is the real
    // account-grain figure, left NULL when the platform reported no engagement
    // signal rather than fabricated.
    //
    // We ship canonical AS-IS (array-level fallback only), NOT a field-level
    // merge from legacy. An adversarial diff vs legacy was investigated against
    // live data (2026-06-20) and the apparent "losses" are not real-data losses
    // the analyst should keep:
    //   - LEGACY IG ER is ALWAYS a derived approximation (er_type =
    //     period_average / posts_derived_daily; legacy has NO native daily IG
    //     ER). On the dates canonical leaves ER null, legacy spreads a period
    //     average across days with no real daily engagement signal — and against
    //     an inferior reach base (e.g. 2026-06-07: legacy ER 0.087 over reach 42
    //     vs canonical real reach 213). Importing it would feed the LLM a smoothed
    //     approximation dressed as a daily number, which is LESS correct than an
    //     honest null. The FB "daily" ER gaps are zeros (engagement = 0), not
    //     signal. Within the 14-day window read below there is NO real-reach,
    //     follower, or real-daily-ER value in legacy that canonical lacks.
    //   - PINTEREST canonical trails by ~3 days. This is the pin_sum writer's
    //     settling cutoff (T-3), not a stall: the writer runs daily and backfills
    //     a trailing window, so 06-18/19/20 materialise as they settle. Legacy's
    //     only edge on those few days is a follower count plus reach=null /
    //     impressions=0 / ER=0 (no real reach content). Inside the window canonical
    //     Pinterest ER equals legacy exactly.
    // So canonical (real-or-absent) is strictly MORE correct than legacy (real
    // reach mixed with derived/zero ER) for this analyst feed; a merge would
    // re-introduce the approximations OPERATIONS-90 set out to remove.
    //
    // Both getters return the SAME Airtable envelope and share the keys this
    // route reads (Platform, Followers, Reach, Engagement Rate, Date), so the
    // reads below are unchanged. Fall back to the legacy table only if Account
    // Daily Facts is absent/empty (e.g. a mid-deploy cached payload without the
    // key, or the getter's own platform-completeness fallback firing),
    // preserving prior behaviour.
    const accountFacts =
      data.accountDailyFacts && data.accountDailyFacts.length > 0
        ? data.accountDailyFacts
        : data.dailyMetrics;

    // Detect active platforms
    const platformSet = new Set<string>();
    for (const r of accountFacts) {
      const p = str(r.fields["Platform"]).toLowerCase().trim();
      if (p) platformSet.add(p);
    }
    const platformCount = Math.max(platformSet.size, 1);

    // Last 14 days of daily metrics (14 days x N platforms)
    const recentDaily = accountFacts
      .map((r) => r.fields)
      .slice(0, 14 * platformCount);

    // Last 50 posts with metrics
    const recentPosts = data.posts.slice(0, 50).map((r) => r.fields);

    // Recent alerts
    const recentAlerts = data.alerts.slice(0, 20).map((r) => r.fields);

    // Platform follower counts (latest per platform)
    const platformLines: string[] = [];
    const seen = new Set<string>();
    for (const r of accountFacts) {
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
Industry benchmarks for reference: Instagram avg ER 1-3%, Facebook avg ER 0.5-1.5%, Pinterest avg ER 0.2-1%, TikTok avg ER 3-9%, YouTube avg ER 1-3%.${
      activeContext
        ? `\n\n---\nThe user is currently viewing this tool. If their question is about it (e.g. "why HOLD?", "what should I change?", "is this profitable?"), answer using THESE figures and explain the reasoning plainly:\n\n${activeContext}`
        : ""
    }`;

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
