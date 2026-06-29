// WEBDEV-288 Part B — independent re-pull of raw per-day reach from Meta Graph for the
// reconciliation check. This is the SOURCE side of "is the canonical store correct vs the
// platform?" — it deliberately re-fetches from Meta (not from Supabase/Airtable) so a
// writer that stored a wrong/transformed reach shows up as a mismatch.
//
// Mirrors the Social Data Refresher's reach endpoints so the day-key convention lines up:
//   IG: /{ig-user}/insights?metric=reach&period=day            (per-day reach)
//   FB: /{page}/insights?metric=page_total_media_view_unique   (the surviving reach PROXY;
//       true page-reach returns #100 since Meta's 2026-06 deprecation — OPERATIONS-89)
//
// Returns ApiReachRow[]: { platform: 'instagram'|'facebook', date: 'YYYY-MM-DD', reach }.
// Throws on any token/API error so the caller can fail LOUD (a long-lived system-user
// token shouldn't fail; if it does, that's a real signal, not noise).

const FB_PAGE_ID = "107021072070181";
const API_VERSION = "v22.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || body == null) {
    throw new Error(`HTTP ${res.status} from ${url.split("?")[0]}`);
  }
  return body;
}

// Map a Meta insights day series to ApiReachRow[], using the metric's end_time date as the
// day key (same convention the SDR stores under — so we compare the same (platform,date)).
function seriesToRows(platform, data) {
  const rows = [];
  for (const metric of data || []) {
    for (const v of metric.values || []) {
      const date = String(v.end_time || "").slice(0, 10);
      if (date && typeof v.value === "number") rows.push({ platform, date, reach: v.value });
    }
  }
  return rows;
}

/**
 * @param {{ token: string, sinceTs: number, untilTs: number }} opts unix-second window
 * @returns {Promise<Array<{platform:string,date:string,reach:number}>>}
 */
export async function fetchMetaReachWindow({ token, sinceTs, untilTs }) {
  if (!token) return [];

  // 1) Exchange the system-user token for the page token + IG user id (one call).
  const pageInfo = await getJson(
    `${BASE}/${FB_PAGE_ID}?fields=access_token,instagram_business_account&access_token=${token}`,
  );
  if (pageInfo.error || !pageInfo.access_token) {
    throw new Error(
      `Meta page-token fetch returned no access_token: ${JSON.stringify(pageInfo.error ?? pageInfo).slice(0, 200)}`,
    );
  }
  const pageToken = pageInfo.access_token;
  const igUserId = pageInfo.instagram_business_account?.id;

  const out = [];

  // 2) IG per-day reach.
  if (igUserId) {
    const ig = await getJson(
      `${BASE}/${igUserId}/insights?metric=reach&period=day&since=${sinceTs}&until=${untilTs}&access_token=${pageToken}`,
    );
    if (ig.error) throw new Error(`IG reach fetch error: ${JSON.stringify(ig.error).slice(0, 200)}`);
    out.push(...seriesToRows("instagram", ig.data));
  }

  // 3) FB per-day reach proxy.
  const fb = await getJson(
    `${BASE}/${FB_PAGE_ID}/insights?metric=page_total_media_view_unique&period=day&since=${sinceTs}&until=${untilTs}&access_token=${pageToken}`,
  );
  if (fb.error) throw new Error(`FB reach fetch error: ${JSON.stringify(fb.error).slice(0, 200)}`);
  out.push(...seriesToRows("facebook", fb.data));

  return out;
}
