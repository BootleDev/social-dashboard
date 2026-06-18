/**
 * A tiny module-level store for the Paid tab's current decision context, so the
 * dashboard-level "Ask AI" chat can answer questions about the live scenario
 * ("why HOLD?", "what should I change?") without threading props through the
 * whole tree. PaidPanel writes a plain-text summary here on every recompute;
 * ChatBox reads it at send-time and includes it in the request when present.
 *
 * Plain text (not a live React value) is deliberate: it's a snapshot of what the
 * user is looking at, captured when they ask. Cleared when the Paid tab unmounts
 * so stale context can't leak into another tab's chat.
 */

let current: string | null = null;

/** Set (or clear, with null) the current paid-decision context summary. */
export function setPaidChatContext(summary: string | null): void {
  current = summary;
}

/** Read the current paid-decision context, or null if the Paid tab isn't active. */
export function getPaidChatContext(): string | null {
  return current;
}
