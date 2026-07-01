/**
 * account_daily_facts platform-completeness guard, extracted from airtable.ts so
 * it is unit-testable without importing the `server-only` / pg chain that
 * airtable.ts pulls in (same rationale as ./supabaseMappers).
 *
 * account_daily_facts is written by TWO independent n8n refreshers (Social:
 * instagram + facebook; Pinterest: pinterest), so a Supabase-side write gap on
 * ONE writer would leave the table partially populated. getAccountDailyFacts
 * requires every expected platform to be present before serving. WEBDEV-216
 * retired the Airtable fallback, so an incomplete read now THROWS (fail-loud)
 * instead of falling back, rather than silently serving a platform's dropped
 * KPIs.
 */

/**
 * Platforms that MUST be present in a healthy account_daily_facts read
 * (WEBDEV-228). account_daily_facts is written by TWO independent n8n writers —
 * the Social Data Refresher (instagram + facebook) and the Pinterest Data
 * Refresher (pinterest) — so a Supabase-side write gap on ONE writer would leave
 * the table partially populated. A bare `rows.length > 0` would happily serve
 * that partial set and silently drop a platform's KPIs.
 *
 * MAINTENANCE: keep this in sync with the platforms the ADF refreshers write.
 * If a new platform is added to the Social/Pinterest Data Refresher write path,
 * add it here — otherwise its absence would never trigger the completeness guard
 * (the read would serve without it). Values are lowercase to match the n8n
 * writers (and hasAllExpectedPlatforms
 * case-folds the read side defensively).
 */
export const EXPECTED_ACCOUNT_PLATFORMS = [
  "instagram",
  "facebook",
  "pinterest",
] as const;

/**
 * True when the mapped account-facts rows carry EVERY expected platform, i.e.
 * the Supabase read is complete enough to serve. Empty in -> false (caller
 * throws / refuses the partial read). Pure (operates on the mapped envelope's
 * `fields['Platform']`), so it is unit-testable without the server-only / pg
 * layer that airtable.ts pulls in (same rationale as buildFields /
 * assertFractionScale).
 *
 * NOTE: this guard catches a SUPABASE-SPECIFIC platform drop only. When the
 * store is stale/partial the WEBDEV-202 reconciler and the OpsPanel freshness
 * panel own it — refusing the partial read cannot help there.
 */
export function hasAllExpectedPlatforms(
  rows: Array<{ fields: Record<string, unknown> }>,
  expected: readonly string[] = EXPECTED_ACCOUNT_PLATFORMS,
): boolean {
  if (rows.length === 0) return false;
  // Case-fold + trim defensively: EXPECTED is lowercase, and a writer that ever
  // emitted "Instagram"/" pinterest " would otherwise make the guard reject a
  // complete read forever despite Supabase having all platforms. Guards the
  // completeness check only — the emitted "Platform" field value is untouched
  // (parity).
  const present = new Set(
    rows.map((r) => String(r.fields["Platform"]).trim().toLowerCase()),
  );
  return expected.every((p) => present.has(p));
}
