/**
 * PlanSelection — the cross-tab carry between Insights ("what worked") and
 * Planning ("when to post"). When an operator clicks "Plan from this →" on a
 * winning Theme × Post Type bar, the chosen theme + format is lifted to
 * DashboardPage state, the active tab switches to Planning, and the
 * "When to post" heatmap filters to the matching posts.
 *
 * Kept in its own module (not inside a component) so both the producing side
 * (ContentAnalysis) and the consuming side (PlanningPanel / BestTimeToPost)
 * import the same shape without a circular dependency.
 */
export interface PlanSelection {
  /** Content Theme value, exactly as stored in Airtable (e.g. "Versatility"). */
  theme: string;
  /** Post Type / format value, exactly as stored (e.g. "Reel", "Static"). */
  postType: string;
}

/** Human-readable label for a selection, e.g. "Versatility · Reel". */
export function planSelectionLabel(sel: PlanSelection): string {
  return [sel.theme, sel.postType].filter(Boolean).join(" · ");
}

/** Structural equality — selections are value objects with no identity. */
export function planSelectionEquals(
  a: PlanSelection | null,
  b: PlanSelection | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.theme === b.theme && a.postType === b.postType;
}
