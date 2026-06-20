/**
 * Per-table kill-switch parsing for the WEBDEV-207 cutover, extracted from
 * airtable.ts so it is unit-testable without importing the `server-only` / pg
 * chain that airtable.ts pulls in (same rationale as ./supabaseMappers).
 * Ported verbatim from ad-dashboard's hardened version (WEBDEV-210) — the
 * original inline check here did a bare `toLowerCase() === "airtable"` with
 * no trim and no typo warning.
 *
 * A switch env var (DAILY_METRICS_SOURCE / WEEKLY_SUMMARIES_SOURCE /
 * SOCIAL_ALERTS_SOURCE) forces the legacy Airtable path when set to
 * "airtable". This is the ONLY manual rollback mechanism, so the match is
 * whitespace- and case-insensitive — a value pasted into Vercel with a
 * trailing newline ("airtable\n") or stray spaces ("  Airtable ") must
 * still roll back. Any other non-empty value logs a console.warn on EVERY
 * call (no memo, stays pure) so a typo ("airtabel") shows up in the Vercel
 * logs instead of silently no-oping the rollback.
 */
export function forcedToAirtable(
  envVar: string | undefined,
  varName: string,
): boolean {
  if (envVar === undefined) return false;
  const normalized = envVar.trim().toLowerCase();
  if (normalized === "airtable") return true;
  if (normalized !== "") {
    console.warn(
      `[kill-switch] ${varName}=${JSON.stringify(envVar)} is not the ` +
        `recognized value "airtable" — switch IGNORED, Supabase-first path ` +
        `stays active. Fix the env var in Vercel and redeploy to roll back.`,
    );
  }
  return false;
}

/**
 * Platforms that MUST be present in a healthy account_daily_facts read
 * (WEBDEV-228). account_daily_facts is written by TWO independent n8n writers —
 * the Social Data Refresher (instagram + facebook) and the Pinterest Data
 * Refresher (pinterest) — so a Supabase-side write gap on ONE writer would leave
 * the table partially populated. A bare `rows.length > 0` would happily serve
 * that partial set and silently drop a platform's KPIs.
 */
export const EXPECTED_ACCOUNT_PLATFORMS = [
  "instagram",
  "facebook",
  "pinterest",
] as const;

/**
 * True when the mapped account-facts rows carry EVERY expected platform, i.e.
 * the Supabase read is complete enough to trust over Airtable. Empty in -> false
 * (fall back). Pure (operates on the mapped envelope's `fields['Platform']`), so
 * it is unit-testable without the server-only / pg layer that airtable.ts pulls
 * in (same rationale as forcedToAirtable / buildFields / assertFractionScale).
 *
 * NOTE: this guard recovers a SUPABASE-SPECIFIC platform drop only. When BOTH
 * stores are stale/partial the WEBDEV-202 reconciler and the OpsPanel freshness
 * panel own it — the Airtable fallback cannot help there.
 */
export function hasAllExpectedPlatforms(
  rows: Array<{ fields: Record<string, unknown> }>,
  expected: readonly string[] = EXPECTED_ACCOUNT_PLATFORMS,
): boolean {
  if (rows.length === 0) return false;
  const present = new Set(rows.map((r) => String(r.fields["Platform"])));
  return expected.every((p) => present.has(p));
}
