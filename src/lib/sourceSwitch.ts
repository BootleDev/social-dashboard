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
