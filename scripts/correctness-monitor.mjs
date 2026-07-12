// Source-truth correctness monitor for the canonical Supabase social.* store
// (WEBDEV-288 Part 2). Unlike the parity cron (Supabase vs Airtable), this validates
// Supabase against HARD INVARIANTS, so it survives retiring the dual-write (WEBDEV-216):
// freshness/dead-writer, engagement_rate in [0,1], non-negative counts, no interior date
// gaps, and core (reach/followers) non-null on recent settled rows. WEBDEV-295/296 are now
// ENFORCED (content-grain ER reproducible @4dp, ERF reproducible, null-symmetry, is_post_day
// consistency — FB+IG). Only the unrecoverable Pinterest aged tail (WEBDEV-297 cancelled)
// stays allowlisted (see ALLOWLIST).
//
// Exit 1 on any violation (red CI check + GitHub emails the author). On failure it also
// POSTs N8N_ALERT_WEBHOOK (if set) so the team gets the existing n8n email alert.
// SELF-SKIPS (exit 0) when SUPABASE_DB_URL is absent, so secretless/fork runs never flake.
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAllChecks, checkWindowFor } from "../src/lib/correctnessChecks.ts";
import { fetchMetaReachWindow } from "./lib/metaReach.mjs";

// Platform names come back from the DB and are interpolated into the window SQL below.
// They are ours, not user input — but quote them properly anyway rather than trusting that.
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.log("[correctness] SKIP — missing SUPABASE_DB_URL");
  process.exit(0);
}

// Same hardened TLS as the app / parity cron (extract the CA PEM from the TS source).
const SUPABASE_CA = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "..", "src", "lib", "supabase-ca.ts"), "utf8");
  const m = src.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  if (!m) throw new Error("could not extract CA PEM from src/lib/supabase-ca.ts");
  return m[0] + "\n";
})();

pg.types.setTypeParser(1082, (v) => v); // date -> raw 'YYYY-MM-DD'

function parseDbUrl(url) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:@/]+)(?::(\d+))?(?:\/([^?]+))?/);
  if (!m) throw new Error("bad SUPABASE_DB_URL");
  const [, user, password, host, port, database] = m;
  return { user, password, host, port: port ? Number(port) : 5432, database: database || "postgres" };
}

const pool = new pg.Pool({ ...parseDbUrl(SUPABASE_DB_URL), ssl: { ca: SUPABASE_CA, rejectUnauthorized: true }, max: 1 });

// Freshness windows (hours). Regular daily writers must update within 2 days; weekly
// reports within 8. Event-driven tables (social_alerts, pipeline_health) are NOT
// freshness-checked — sparse-by-design, a quiet day is not a dead writer.
const FRESHNESS = {
  account_daily_facts: 48, daily_account_metrics: 48, post_daily_facts: 48,
  pinterest_top_pins: 48, pinterest_trends_keywords: 48, instagram_audience: 48,
  weekly_summaries: 192, trend_reports: 192,
};

try {
  // 1) Freshness: hours since each table's last write.
  const freshSql = Object.keys(FRESHNESS)
    .map((t) => `select '${t}' as tbl, extract(epoch from (now()-max(updated_at)))/3600.0 as age_h from social.${t}`)
    .join("\nunion all\n");
  const fresh = (await pool.query(freshSql)).rows.map((r) => ({
    table: r.tbl, ageHours: r.age_h === null ? null : Number(r.age_h),
  }));

  // 1b) WEBDEV-536: which platforms are LIVE in the table, and how stale is each one's
  // writer? account_daily_facts has FOUR writers, so the table-level freshness above cannot
  // see any single one of them die. "Live" = wrote at all in the last 60 days, so a platform
  // we genuinely retire ages out instead of alarming forever.
  // `oldest_age_days` is what lets coverage tell "the monitor is blind to this platform"
  // apart from "this platform is 3 days old and cannot have a settled row yet".
  const platformRows = (await pool.query(
    `select platform,
            extract(epoch from (now()-max(updated_at)))/3600.0 as age_h,
            (current_date - min(date))::int as oldest_age_days
       from social.account_daily_facts
      where date >= (current_date - interval '60 days')
      group by platform
      order by platform`,
  )).rows;
  const platformFreshness = platformRows.map((r) => ({
    platform: r.platform, ageHours: r.age_h === null ? null : Number(r.age_h),
  }));
  const livePlatforms = platformRows.map((r) => ({
    platform: r.platform,
    oldestRowAgeDays: r.oldest_age_days === null ? null : Number(r.oldest_age_days),
  }));
  const livePlatformNames = platformRows.map((r) => r.platform);

  // 2) Recent SETTLED account-grain rows for the value/gap checks — PER-PLATFORM window
  // (WEBDEV-536). A row is only `settled` once it is older than its platform's settle window
  // (FB=3d, IG=21d), so a single fixed band silently excluded Instagram entirely: it could
  // never be both settled (>21d) and inside the old 3-16d band. The band is now derived from
  // the same settle constants, offset past each platform's settle window.
  const windowClauses = livePlatformNames
    .map((p) => {
      const { minAgeDays, maxAgeDays } = checkWindowFor(p);
      return `(platform = ${lit(p)} and date >= (current_date - interval '${maxAgeDays} days') and date <= (current_date - interval '${minAgeDays} days'))`;
    })
    .join("\n            or ");

  const factsRows = livePlatformNames.length === 0 ? [] : (await pool.query(
    `select platform, to_char(date,'YYYY-MM-DD') as date,
            reach::int as reach, impressions::int as impressions, followers::int as followers,
            engagement::int as engagement, engagement_rate::float8 as engagement_rate,
            content_reach::int as content_reach,
            engagement_rate_followers::float8 as engagement_rate_followers,
            coalesce(is_post_day, false) as is_post_day
       from social.account_daily_facts
      where data_status='settled'
        and (${windowClauses})
      order by platform, date`,
  )).rows.map((r) => ({ table: "account_daily_facts", ...r }));

  const platforms = [...new Set(factsRows.map((r) => r.platform))];

  // 3) Platform-API reconciliation (WEBDEV-288 Part B): independently re-pull raw per-day
  // reach from Meta Graph (FB+IG) for the same window and compare to the stored canonical
  // reach. Catches "both stores wrong the same way" (a writer transform bug is parity- AND
  // invariant-blind). Meta-only for now (long-lived system-user token; Pinterest token
  // expiry makes CI brittle — deferred). Skips cleanly without META_ACCESS_TOKEN.
  let apiReach = [];
  let reconError = null;
  const META_TOKEN = process.env.META_ACCESS_TOKEN;
  if (META_TOKEN) {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      // Pad the settled window (today-16..today-3) by a day each side; the pure check only
      // compares (platform,date) pairs present in BOTH sides, so extra API days are harmless.
      apiReach = await fetchMetaReachWindow({
        token: META_TOKEN,
        sinceTs: nowSec - 17 * 86400,
        untilTs: nowSec - 2 * 86400,
      });
      console.log(`[correctness] reconciliation: pulled ${apiReach.length} Meta reach point(s)`);
    } catch (e) {
      reconError = e.message;
      console.error("[correctness] reconciliation fetch FAILED:", e.message);
    }
  } else {
    console.log("[correctness] reconciliation: SKIP — no META_ACCESS_TOKEN");
  }

  const violations = runAllChecks({
    freshness: fresh, facts: factsRows, freshnessMaxAgeHours: FRESHNESS, platforms, apiReach,
    platformFreshness, livePlatforms,
  });
  // A failed reconciliation fetch is itself a LOUD failure — a long-lived system-user token
  // should not fail; if it does, the source-truth check is silently dark (the very class
  // WEBDEV-290 fought), so surface it as a violation rather than swallowing it.
  if (reconError) {
    violations.push({
      check: "platform-reconciliation",
      severity: "fail",
      detail: `Meta reach fetch failed — reconciliation could not run (token revoked / API change?): ${reconError}`,
    });
  }

  // Say EXACTLY what was covered, per platform. A bare row count hid WEBDEV-536 for 9 days:
  // "PASS" looked identical whether Instagram was checked or silently absent.
  const perPlatform = livePlatformNames
    .map((p) => {
      const n = factsRows.filter((r) => r.platform === p).length;
      const w = checkWindowFor(p);
      return `${p}=${n} row(s) [age ${w.minAgeDays}-${w.maxAgeDays}d]`;
    })
    .join(", ");
  console.log(`[correctness] checked ${fresh.length} tables for freshness + ${factsRows.length} settled rows — coverage: ${perPlatform}; reconciled ${apiReach.length} Meta reach point(s)`);

  const fails = violations.filter((v) => v.severity === "fail");
  if (fails.length === 0) {
    console.log("[correctness] PASS — all invariants hold");
    await pool.end();
    process.exit(0);
  }

  console.error(`\n[correctness] FAIL — ${fails.length} violation(s):`);
  for (const v of fails) console.error(`  [${v.check}] ${v.detail}`);

  const webhook = process.env.N8N_ALERT_WEBHOOK;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "correctness-monitor",
          subject: `Supabase correctness monitor: ${fails.length} violation(s)`,
          violations: fails,
        }),
      });
      console.error("[correctness] alert POSTed to N8N_ALERT_WEBHOOK");
    } catch (e) {
      console.error("[correctness] alert POST failed:", e.message);
    }
  }
  await pool.end();
  process.exit(1);
} catch (e) {
  console.error("[correctness] ERROR:", e.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
