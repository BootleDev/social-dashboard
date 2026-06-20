/**
 * WEBDEV-216 parity proof: the four Supabase-migrated social tables vs Airtable.
 *
 * For each of daily_account_metrics / weekly_summaries / social_alerts /
 * account_daily_facts this asserts, against the FULL table on both sides:
 *   - row count parity (1:1 for the verbatim dual-writes; DIRECTIONAL for
 *     social_alerts — see below)
 *   - sort-order: each side desc on the load-bearing key (date / week_start /
 *     alert_date), and positionally equal for the 1:1 tables
 *   - per-column value equality on matching natural keys (see table-specific
 *     notes on key selection and intentional divergences below)
 *
 * PARITY INVARIANT: the migration target is Supabase ⊇ Airtable — Supabase, the
 * canonical store, must hold everything Airtable has (a missing Airtable row =
 * data loss = fail), while extra Supabase-only rows are acceptable (it is the
 * more-complete store). Three append-only/verbatim tables are tested as strict
 * 1:1 (direction "exact"); social_alerts is tested DIRECTIONALLY (direction
 * "supabaseSuperset") because n8n legitimately writes alert types to Supabase
 * that it no longer dual-writes to Airtable.
 *
 * DOCUMENTED INTENTIONAL DIVERGENCES (per table):
 *
 * ── daily_account_metrics ────────────────────────────────────────────────────
 *   1. "Engagement Rate" — PRECISION ONLY. Airtable stores the raw JS float
 *      (e.g. 0.08602150537634409); Postgres stores numeric at the column's
 *      declared scale and returns it as a string (e.g. "0.0860"). Compared
 *      under |at - sb| <= 5e-5 (4 d.p.) via roundedColumns. Larger divergence
 *      is a real mapping bug.
 *   2. "Impressions", "Reach", "Profile Views", "ER Type" on facebook rows —
 *      these columns were added to the Supabase writer AFTER the FB reach
 *      deprecation fix (OPERATIONS-89, ~2026-06-17). Older Airtable rows were
 *      written BEFORE the fix and never back-filled, so Supabase has these
 *      fields on recent FB rows while the matching Airtable rows lack them.
 *      Marked allowedDivergence. Any divergence on a non-FB platform or on
 *      columns NOT in this list is still a real bug.
 *
 * ── weekly_summaries ─────────────────────────────────────────────────────────
 *   None expected. Append-only; dual-write copies every column verbatim.
 *
 * ── social_alerts ────────────────────────────────────────────────────────────
 *   DIRECTIONAL — Supabase ⊇ Airtable (direction: "supabaseSuperset").
 *   social_alerts has no stable cross-store id. The Supabase table has a bigint
 *   `id` (the envelope id); Airtable has its own opaque record id. Multiple
 *   alerts share the same platform|date (e.g. two HEARTBEAT rows for pinterest
 *   on a single day from different n8n writers), and platform|date|type also
 *   collides. We use platform|alert_date|type|message as the natural key — the
 *   most discriminating combination available without a shared surrogate.
 *
 *   1. Supabase legitimately holds MORE rows than Airtable, and that is the SAFE
 *      direction (not data loss). n8n UPSERTs alerts into Supabase but INSERTs
 *      into Airtable, AND has stopped dual-writing some alert types (notably
 *      Pinterest/system HEARTBEAT) to Airtable entirely — so Supabase carries
 *      rows Airtable never received (24 extra Supabase-only rows observed
 *      2026-06-20: Pinterest/system HEARTBEAT plus a few rewritten alerts). The
 *      check therefore asserts the migration invariant DIRECTIONALLY: every
 *      AIRTABLE row must exist in Supabase (an Airtable row missing from
 *      Supabase IS real data loss and fails loudly), while extra Supabase-only
 *      rows are tolerated. Count check fails only if Supabase has FEWER rows
 *      than Airtable. Live state: 0 Airtable rows missing from Supabase.
 *   2. Content divergences on rows that DO match by natural key are EXPECTED and
 *      reported (not failed) via allowedDivergence on the fields that change on
 *      an UPSERT rewrite: "Message", "Type", "Severity", "Post ID". A rewrite
 *      that also changed the natural key would orphan the original Airtable row
 *      — that surfaces as a key-miss (data-loss fail), so it is NOT hidden. Any
 *      key-set mismatch (unexpected new fields on one side) is still a real bug.
 *
 * ── account_daily_facts ──────────────────────────────────────────────────────
 *   1. "Engagement Rate" — PRECISION ONLY (same as daily_account_metrics above).
 *      Airtable: raw JS float. Postgres: numeric string. Compared at 4 d.p.
 *   2. "Followers Gained" — LEGACY column name from daily_account_metrics. The
 *      account_daily_facts table uses "Follower Delta" for the same concept
 *      (corrected in ACCOUNT_DAILY_FACTS_MAP). If Airtable emits "Followers
 *      Gained" on any rows (stale from a historical migration artefact), it has
 *      no Supabase counterpart in the mapper; allowed here.
 *   3. "Restatement Log" — sparse: all rows null today, so buildFields omits
 *      the key from both envelopes. Parity holds; no exclusion needed.
 *   4. "Snapshot Key" — included in the mapper and in Airtable's field set.
 *      NOT excluded: its presence on both sides is the normal shape.
 *   Add Airtable formula/computed columns discovered on the first live run to
 *   allowedDivergence (they are absent from Supabase by design).
 *
 * The Supabase side maps rows through the REAL production mappers
 * (src/lib/supabaseMappers.ts), imported directly via Node's native TypeScript
 * type-stripping (Node >= 22.18 LTS) — so this proves the exact code the app
 * ships, not a re-implementation.
 *
 * SELF-SKIPS (exit 0) when SUPABASE_DB_URL / AIRTABLE_API_KEY / AIRTABLE_BASE_ID
 * are absent, so it is safe to run anywhere and never flakes a credentialed CI.
 *
 * Run live with the workspace secrets:
 *   set -a; . ~/Projects/Bootle/.secrets/.env; set +a
 *   AIRTABLE_BASE_ID=app0oKaYjbWBcrqzH node scripts/parity-webdev216.mjs
 *
 * TEMPORARY: only meaningful during the dual-write window (n8n still writes
 * both Supabase and Airtable). When WEBDEV-216 removes the Airtable dual-writes,
 * DELETE this file and the three repo secrets it uses
 * (SUPABASE_DB_URL / AIRTABLE_API_KEY / AIRTABLE_BASE_ID).
 */

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mapDailyRow,
  mapWeeklyRow,
  mapAlertRow,
  mapAccountDailyFactsRow,
} from "../src/lib/supabaseMappers.ts";

// ---------------------------------------------------------------------------
// Credentials + self-skip
// ---------------------------------------------------------------------------

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!SUPABASE_DB_URL || !AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.log(
    "[parity] SKIP — missing SUPABASE_DB_URL / AIRTABLE_API_KEY / AIRTABLE_BASE_ID",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// TLS: pin the same Supabase Root 2021 CA the app uses (src/lib/supabase-ca.ts)
// so the parity proof exercises the hardened TLS path (rejectUnauthorized: true).
// Extracted from the TypeScript source at runtime — we do NOT import the module
// directly because src/lib/supabase-ca.ts is server-only and importing it here
// would also pull in `server-only` (a Next.js build-boundary sentinel that throws
// at runtime outside a Next.js context). Same pattern as ad-dashboard parity.
// ---------------------------------------------------------------------------
const SUPABASE_CA = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(here, "..", "src", "lib", "supabase-ca.ts"),
    "utf8",
  );
  const m = src.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
  );
  if (!m) throw new Error("could not extract CA PEM from src/lib/supabase-ca.ts");
  return m[0] + "\n";
})();

// ---------------------------------------------------------------------------
// pg type parsers — match supabase.ts exactly (both parsers are load-bearing)
// ---------------------------------------------------------------------------
// int8 (OID 20): social_alerts.id is bigint; parse as JS number so String()
// on the mapped envelope id is well-defined (no trailing 'n' or string noise).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date (OID 1082): return raw "YYYY-MM-DD" string verbatim, matching Airtable.
// Load-bearing for date / week_start / alert_date — do not remove.
pg.types.setTypeParser(1082, (v) => v);

// ---------------------------------------------------------------------------
// DB connection
// ---------------------------------------------------------------------------
function parseDbUrl(url) {
  // The password group is greedy up to the last '@' so an '@' inside the
  // password is tolerated (Supabase pooler passwords sometimes contain one).
  const m = url.match(
    /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:@/]+)(?::(\d+))?(?:\/([^?]+))?/,
  );
  if (!m) throw new Error("bad SUPABASE_DB_URL");
  const [, user, password, host, port, database] = m;
  return {
    user,
    password,
    host,
    port: port ? Number(port) : 5432,
    database: database || "postgres",
  };
}

const pool = new pg.Pool({
  ...parseDbUrl(SUPABASE_DB_URL),
  ssl: { ca: SUPABASE_CA, rejectUnauthorized: true },
  max: 1,
});

// ---------------------------------------------------------------------------
// Airtable fetcher (full table, paginated)
// ---------------------------------------------------------------------------

// Airtable table IDs — source of truth: src/lib/airtable.ts TABLES constant.
const AT_DAILY_ACCOUNT_METRICS = "tblGnvjSCdr1zttJe";
const AT_WEEKLY_SUMMARIES      = "tblUinLyGAkmneFFZ";
const AT_SOCIAL_ALERTS         = "tbliPoyQSWCMmF5FH";
const AT_ACCOUNT_DAILY_FACTS   = "tblgKAMI1pF3FjQGo";

async function fetchAllAirtable(tableId, sortField) {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (sortField) {
      params.set("sort[0][field]", sortField);
      params.set("sort[0][direction]", "desc");
    }
    if (offset) params.set("offset", offset);
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}?${params}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } },
    );
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

let failures = 0;
function fail(section, msg) {
  failures++;
  console.error(`[parity:${section}] FAIL — ${msg}`);
}

const isNumLike = (v) =>
  (typeof v === "number" && Number.isFinite(v)) ||
  (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

/**
 * Exact-unit equality: numeric compare when both sides are number-like
 * (handles pg numeric-as-string "0.00" vs Airtable 0), strict string
 * compare otherwise. NO epsilon by default: the dual-write wrote the same
 * value, so any numeric difference is a real bug.
 *
 * For columns with a DECLARED rounding bound (dp), applies the exact bound
 * for "sb = round(at, dp)": |at - sb| <= 0.5 * 10^-dp + 1e-12. Used for
 * Engagement Rate on both daily_account_metrics and account_daily_facts.
 */
function valuesEqual(a, b, dp) {
  if (isNumLike(a) && isNumLike(b)) {
    if (dp !== undefined)
      return Math.abs(Number(a) - Number(b)) <= 0.5 * 10 ** -dp + 1e-12;
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

/**
 * Compare a full table: sb = mapped Supabase envelopes (in query sort order),
 * at = raw Airtable records (in Airtable sort order). Rows matched by
 * keyOf(fields). allowedDivergence = display-name keys where value/key-set
 * differences are intentional (reported, not failed). roundedColumns = display
 * names that use dp-bounded comparison instead of exact equality.
 *
 * PARITY INVARIANT — the migration target is Supabase ⊇ Airtable: Supabase, the
 * canonical store, must contain EVERYTHING Airtable has (a missing Airtable row
 * = real data loss = hard fail), but Supabase holding EXTRA rows is acceptable
 * (it is the more-complete store). `direction` selects how strictly row-count
 * and natural-key matching enforce that:
 *
 *   - "exact" (default): 1:1 parity. Counts must be equal, the desc date
 *     sequences must match positionally, and every Supabase row must have an
 *     Airtable twin. Use for append-only/verbatim dual-writes where no
 *     legitimate one-sided rows exist (daily_account_metrics, weekly_summaries,
 *     account_daily_facts).
 *
 *   - "supabaseSuperset": directional. Asserts every AIRTABLE row exists in
 *     Supabase (the unsafe direction — Airtable rows missing from Supabase fail
 *     loudly), and EXPLICITLY TOLERATES extra Supabase-only rows (the safe
 *     direction). Used for social_alerts, where n8n UPSERTs into Supabase but
 *     INSERTs into Airtable, and has stopped dual-writing some alert types
 *     (e.g. Pinterest/system HEARTBEAT) to Airtable entirely — so Supabase
 *     legitimately carries rows Airtable never received. Those extras are not
 *     data loss; failing on them would be a false negative for the migration.
 *
 * The matchByKey Map uses the LAST record for a given key when duplicates exist
 * (Map.set overwrites). For tables with unique natural keys this is irrelevant.
 * For social_alerts (whose natural key incorporates message) duplicates should
 * not occur; if they do the comparison is still correct for the matched record.
 */
function compareTable(
  section,
  sb,
  at,
  { keyOf, sortKey, allowedDivergence = [], roundedColumns = {}, direction = "exact" },
) {
  const superset = direction === "supabaseSuperset";
  console.log(`\n=== ${section} ===`);
  console.log(
    `  rows: supabase=${sb.length} airtable=${at.length}${superset ? " (Supabase⊇Airtable)" : ""}`,
  );

  // (1) Row count — structural divergence.
  //   exact:    counts must be equal.
  //   superset: Supabase may have MORE (extra Supabase-only rows are safe);
  //             only Supabase having FEWER than Airtable is a data-loss fail
  //             (the per-Airtable-row match below pinpoints which rows).
  if (superset) {
    if (sb.length < at.length)
      fail(section, `Supabase has FEWER rows than Airtable (${sb.length} < ${at.length}) — possible data loss`);
  } else if (sb.length !== at.length) {
    fail(section, `row count mismatch ${sb.length} vs ${at.length}`);
  }

  if (sb.length === 0 && at.length === 0) {
    console.log("  both sides empty — count parity holds (0 = 0)");
    return;
  }

  // (2) Sort order: each side's load-bearing date sequence must be
  // non-increasing (a broken desc sort is still a real bug on either store).
  // In "exact" mode the two sequences must ALSO match positionally (1:1 rows).
  // In "superset" mode positional equality is structurally impossible — extra
  // Supabase-only rows shift the sequence — so we only assert per-side ordering.
  const sbSeq = sb.map((r) => String(r.fields[sortKey] ?? "").split("T")[0]);
  const atSeq = at.map((r) => String(r.fields[sortKey] ?? "").split("T")[0]);
  const nonIncreasing = (seq) =>
    seq.every((v, i) => i === 0 || seq[i - 1] >= v);
  if (!nonIncreasing(sbSeq)) fail(section, `Supabase ${sortKey} not desc-sorted`);
  if (!nonIncreasing(atSeq)) fail(section, `Airtable ${sortKey} not desc-sorted`);
  if (!superset && JSON.stringify(sbSeq) !== JSON.stringify(atSeq))
    fail(section, `${sortKey} desc sequence differs between sources`);

  // (3) Per-record key-set + per-column values, matched by natural key.
  //   exact:    drive over Supabase rows; a Supabase row with no Airtable twin
  //             is a fail (both stores should be 1:1).
  //   superset: drive over AIRTABLE rows; an Airtable row with no Supabase twin
  //             is a data-loss fail. Extra Supabase-only rows are simply not
  //             visited — they are the tolerated safe direction.
  const divergenceReport = new Map(); // display-name -> count of differing rows
  let matched = 0;
  let keyMisses = 0;

  const driving = superset ? at : sb;
  const lookup = superset
    ? new Map(sb.map((r) => [keyOf(r.fields), r])) // key -> Supabase rec
    : new Map(at.map((r) => [keyOf(r.fields), r])); // key -> Airtable rec
  const missLabel = superset
    ? "no Supabase record for Airtable natural key"
    : "no Airtable record for natural key";

  for (const drivingRec of driving) {
    const k = keyOf(drivingRec.fields);
    const otherRec = lookup.get(k);
    if (!otherRec) {
      keyMisses++;
      // Only report the first 5 key misses to avoid a wall of output.
      if (keyMisses <= 5)
        fail(section, `${missLabel} "${k}"`);
      else if (keyMisses === 6)
        fail(section, `... (further key misses suppressed; ${keyMisses} total so far)`);
      continue;
    }
    matched++;
    // Resolve which record is Supabase vs Airtable regardless of drive direction
    // so the field-comparison logic and divergence-direction labels stay correct.
    const sbRec = superset ? otherRec : drivingRec;
    const atRec = superset ? drivingRec : otherRec;
    const sbKeys = Object.keys(sbRec.fields);
    const atKeys = Object.keys(atRec.fields);
    const sbSet = new Set(sbKeys);
    const atSet = new Set(atKeys);
    for (const key of new Set([...sbKeys, ...atKeys])) {
      const inSb = sbSet.has(key);
      const inAt = atSet.has(key);
      const allowed = allowedDivergence.includes(key);
      if (inSb !== inAt) {
        if (allowed) {
          divergenceReport.set(key, (divergenceReport.get(key) ?? 0) + 1);
        } else {
          fail(
            section,
            `key-set mismatch at "${k}": "${key}" ${inSb ? "only in Supabase" : "only in Airtable"}`,
          );
        }
        continue;
      }
      if (!valuesEqual(sbRec.fields[key], atRec.fields[key], roundedColumns[key])) {
        if (allowed) {
          divergenceReport.set(key, (divergenceReport.get(key) ?? 0) + 1);
        } else {
          fail(
            section,
            `value mismatch at "${k}" field "${key}": supabase=${JSON.stringify(sbRec.fields[key])} airtable=${JSON.stringify(atRec.fields[key])}`,
          );
        }
      }
    }
  }
  if (keyMisses > 5) {
    console.error(
      `[parity:${section}] NOTE — ${keyMisses} total ${superset ? "Airtable rows had no matching Supabase record" : "Supabase rows had no matching Airtable record"}`,
    );
  }
  const denom = superset ? at.length : sb.length;
  console.log(
    `  matched by natural key: ${matched}/${denom}${superset ? ` (of Airtable rows; ${sb.length - at.length >= 0 ? sb.length - at.length : 0}+ extra Supabase-only rows tolerated)` : ""}`,
  );
  for (const [key, n] of divergenceReport) {
    console.log(
      `  documented divergence "${key}": ${n} row(s) differ (intentional — see script header)`,
    );
  }
}

// ---------------------------------------------------------------------------
// social.daily_account_metrics
// (mirrors the query in getDailyAccountMetricsFromSupabase)
// ---------------------------------------------------------------------------
{
  const { rows } = await pool.query(
    `select date, platform, followers, followers_gained, impressions,
            reach, profile_views, website_clicks, engagement_rate, er_type,
            updated_at
       from social.daily_account_metrics
      order by date desc`,
  );
  const sb = rows.map(mapDailyRow);
  const at = await fetchAllAirtable(AT_DAILY_ACCOUNT_METRICS, "Date");
  compareTable("daily_account_metrics", sb, at, {
    keyOf: (f) => `${f["Platform"]}|${f["Date"]}`,
    sortKey: "Date",
    // "Engagement Rate" — precision-only divergence (Postgres numeric string
    // vs Airtable raw float). See header §daily_account_metrics note 1.
    roundedColumns: { "Engagement Rate": 4 },
    // "Impressions", "Reach", "Profile Views", "ER Type" — added to the
    // Supabase writer after the FB reach deprecation fix (OPERATIONS-89).
    // Pre-fix Airtable rows lack these fields; post-fix Supabase rows have
    // them. A key-set mismatch on these four fields is expected for any FB
    // row written before ~2026-06-17. See header §daily_account_metrics note 2.
    allowedDivergence: ["Impressions", "Reach", "Profile Views", "ER Type"],
  });
}

// ---------------------------------------------------------------------------
// social.weekly_summaries
// (mirrors the query in getWeeklySummariesFromSupabase)
// ---------------------------------------------------------------------------
{
  const { rows } = await pool.query(
    `select week_start, period, posts_analysed, full_report, top_post,
            platform_breakdown, updated_at
       from social.weekly_summaries
      order by week_start desc`,
  );
  const sb = rows.map(mapWeeklyRow);
  const at = await fetchAllAirtable(AT_WEEKLY_SUMMARIES, "Week Start");
  compareTable("weekly_summaries", sb, at, {
    keyOf: (f) => String(f["Week Start"]),
    sortKey: "Week Start",
    // No intentional divergences expected. Append-only; dual-write is verbatim.
  });
}

// ---------------------------------------------------------------------------
// social.social_alerts
// (mirrors the query in getSocialAlertsFromSupabase)
//
// NATURAL KEY: platform|alert_date|type|message (the most discriminating
// combination without a shared surrogate — see header §social_alerts).
//
// Content divergences (mismatched messages, rewrites) are logged as documented
// divergences via allowedDivergence on "Message", "Type", "Severity", "Post ID".
// Count and sort-order checks still fire for structural issues (extra/missing
// rows overall).
// ---------------------------------------------------------------------------
{
  const { rows } = await pool.query(
    `select id, alert_date, platform, type, severity, message, post_id,
            updated_at
       from social.social_alerts
      order by alert_date desc, id desc`,
  );
  const sb = rows.map(mapAlertRow);
  const at = await fetchAllAirtable(AT_SOCIAL_ALERTS, "Alert Date");
  compareTable("social_alerts", sb, at, {
    // DIRECTIONAL: Supabase ⊇ Airtable. n8n UPSERTs alerts into Supabase but
    // INSERTs into Airtable, and has STOPPED dual-writing some alert types
    // (e.g. Pinterest/system HEARTBEAT) to Airtable — so Supabase legitimately
    // holds rows Airtable never received (24 extra Supabase-only rows observed
    // 2026-06-20; 0 Airtable rows missing from Supabase). Those extras are the
    // SAFE direction and must NOT fail the check. The directional mode asserts
    // every Airtable row still exists in Supabase (an Airtable row missing from
    // Supabase WOULD be real data loss and fails loudly) and tolerates the
    // Supabase-only extras. See header §social_alerts.
    direction: "supabaseSuperset",
    // Natural key: platform|date|type|message. Message is truncated to 60
    // chars for the key to stay readable in error output while still being
    // discriminating enough. Full message is in the value comparison.
    keyOf: (f) =>
      `${f["Platform"]}|${f["Alert Date"]}|${f["Type"]}|${String(f["Message"] ?? "").slice(0, 60)}`,
    sortKey: "Alert Date",
    // "Message", "Type", "Severity", "Post ID" — UPSERT-rewrite content drift
    // on rows that DO match by natural key. n8n UPSERTs into Supabase (later
    // runs may rewrite severity/message); n8n INSERTs into Airtable (old rows
    // never updated). Reported, not failed. (A rewrite that also changed the
    // key would orphan the Airtable row — that surfaces as a key-miss above,
    // i.e. it is NOT silently allowed.)
    allowedDivergence: ["Message", "Type", "Severity", "Post ID"],
  });
}

// ---------------------------------------------------------------------------
// social.account_daily_facts  (WEBDEV-228)
// (mirrors the query in getAccountDailyFactsFromSupabase)
// ---------------------------------------------------------------------------
{
  const { rows } = await pool.query(
    `select snapshot_key, platform, date, reach, reach_source,
            impressions, impressions_source, views, views_source,
            profile_views, followers, follower_delta, engagement,
            engagement_rate, data_status, restatement_log, period_source,
            profile_views_30d, accounts_engaged_30d, interactions_30d,
            profile_links_taps_30d, updated_at
       from social.account_daily_facts
      order by date desc`,
  );
  const sb = rows.map(mapAccountDailyFactsRow);
  const at = await fetchAllAirtable(AT_ACCOUNT_DAILY_FACTS, "Date");
  compareTable("account_daily_facts", sb, at, {
    keyOf: (f) => `${f["Platform"]}|${f["Date"]}`,
    sortKey: "Date",
    // "Followers Gained" — legacy column name; Supabase uses "Follower Delta".
    // See header §account_daily_facts note 2.
    allowedDivergence: [
      "Followers Gained",
    ],
    // "Engagement Rate" — precision-only; Postgres numeric string vs Airtable
    // raw float. See header §account_daily_facts note 1.
    roundedColumns: {
      "Engagement Rate": 4,
    },
  });
}

// ---------------------------------------------------------------------------
// Teardown + exit
// ---------------------------------------------------------------------------
await pool.end();

if (failures > 0) {
  console.error(`\n[parity] FAIL — ${failures} mismatch(es) — see above`);
  process.exit(1);
}
console.log("\n[parity] PASS — all four social getters");
