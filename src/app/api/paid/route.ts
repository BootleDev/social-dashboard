import { NextResponse } from "next/server";
import { getMarketingBaselineData } from "@/lib/marketingIntelligence";
import { estimateBaseline, defaultBaselineWindow } from "@/lib/adBaseline";

/** All-encompassing window — pool over every row regardless of date. */
const ALL_TIME = { start: "1970-01-01", end: "2999-12-31" } as const;

/**
 * Paid simulator data: pool a measured Baseline from the Marketing Intelligence
 * base over the recent active-spend window, and return it plus the raw rows so
 * the client can re-estimate over a different window without another Airtable
 * read. Auth is enforced by middleware for all /api/* except /api/auth.
 */
export async function GET() {
  try {
    const { daily, shopify, adSnapshots } = await getMarketingBaselineData();

    // Default window = the most recent active spend-days (see
    // defaultBaselineWindow): keeps the pooled baseline representative of
    // current campaign behaviour rather than diluted by the long zero-spend
    // tail or stale months of intermittent spend.
    const window = defaultBaselineWindow(daily);
    const baseline = estimateBaseline(daily, shopify, window, adSnapshots);

    // Shopify data is FRESH (runs months past the stale ad window). Pool a
    // store-AOV over ALL Shopify rows (comp/discount orders already excluded by
    // estimateAov) so the UI can default AOV to a current figure rather than the
    // stale ad-window basket. Reuses the same estimator over an all-time window.
    const freshBaseline = estimateBaseline(daily, shopify, ALL_TIME, adSnapshots);
    const freshShopifyAov = freshBaseline.shopifyAov;

    return NextResponse.json({ baseline, freshShopifyAov, daily, shopify, window });
  } catch (err) {
    console.error("Paid API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch paid marketing data" },
      { status: 500 },
    );
  }
}
