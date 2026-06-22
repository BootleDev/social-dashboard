// Source-truth correctness monitor for the canonical Supabase social.* store
// (WEBDEV-288 Part 2). Unlike the parity cron (Supabase vs Airtable), this validates
// Supabase against HARD INVARIANTS, so it survives retiring the dual-write (WEBDEV-216):
// freshness/dead-writer, engagement_rate in [0,1], non-negative counts, no interior date
// gaps, and core (reach/followers) non-null on recent settled rows. Known/filed gaps
// (WEBDEV-295/296/297) are owned by those tickets and not failed here (see ALLOWLIST).
//
// Exit 1 on any violation (red CI check + GitHub emails the author). On failure it also
// POSTs N8N_ALERT_WEBHOOK (if set) so the team gets the existing n8n email alert.
// SELF-SKIPS (exit 0) when SUPABASE_DB_URL is absent, so secretless/fork runs never flake.
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAllChecks } from "../src/lib/correctnessChecks.ts";

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

  // 2) Recent SETTLED account-grain rows (today-16 .. today-3) for the value/gap checks.
  const factsRows = (await pool.query(
    `select platform, to_char(date,'YYYY-MM-DD') as date,
            reach::int as reach, impressions::int as impressions, followers::int as followers,
            engagement::int as engagement, engagement_rate::float8 as engagement_rate
       from social.account_daily_facts
      where data_status='settled'
        and date >= (current_date - interval '16 days')
        and date <= (current_date - interval '3 days')
      order by platform, date`,
  )).rows.map((r) => ({ table: "account_daily_facts", ...r }));

  const platforms = [...new Set(factsRows.map((r) => r.platform))];

  const violations = runAllChecks({
    freshness: fresh, facts: factsRows, freshnessMaxAgeHours: FRESHNESS, platforms,
  });

  console.log(`[correctness] checked ${fresh.length} tables for freshness + ${factsRows.length} settled rows across ${platforms.join(", ")}`);

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
