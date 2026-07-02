# FB/IG post-facts persistence + per-platform settlement — design

**Tickets:** WEBDEV-351 (persist FB/IG per-post facts to `social.post_daily_facts`) + WEBDEV-352 (per-platform settle window / FB-vs-IG accrual honesty). Handled together because both hinge on one field — `data_status` — and folding them puts the settle-window definition in one place.

**Lineage:** direct follow-up to the WEBDEV-295/296 ER rebuild (`docs/superpowers/plans/2026-06-29-er-metric-rebuild.md`). Tier 3 (writer change + live dashboard metric behaviour). Spans two repos: `bootle-n8n` (writer) and `social-dashboard` (reader).

---

## 1. Problem

**351 — post-level data is discarded.** The n8n "Social Data Refresher" (`jKL4KjIiWyea6dyM`) computes FB/IG per-post engagement + reach in memory each run and writes them only to the **Airtable** Posts table (`app0oKaYjbWBcrqzH` / `tbljDi7YY46pQkQGH`). Only Pinterest is persisted to `social.post_daily_facts` (FB/IG = 0 rows there). That is why the 295/296 history backfill had to source FB/IG from Airtable — a store WEBDEV-216 is retiring. We want FB/IG per-post facts in `post_daily_facts` going forward so reproducibility + any future backfill is Airtable-independent.

**352 — settlement is not honest per platform, and nothing enforces it.** FB posts reach ~90% of lifetime engagement/reach within ~72h; IG Reels keep accruing for 2–6 weeks. With publish-date attribution, a recent IG row is "younger" than a recent FB row on the same date, so cross-platform ER comparison is structurally biased against IG in exactly the recent/actionable window. Two facts found during design:
- The writer's `dataStatusFor()` uses a **single global `SETTLE_DAYS = 2`** for both platforms — IG is marked `settled` after 2 days while still accruing.
- **The dashboard does not filter the ER comparison by `data_status` at all.** `PlatformCompare.tsx` (the exact component 352 names) plots ER trend lines + an "Avg ER %" bar over all dates with no settle gating. The ticket's premise ("the dashboard already filters trend views to `data_status='settled'`") is inaccurate — verified 2026-07-02. So the bias is real *and* currently unmitigated end-to-end.

---

## 2. Decisions (resolved during brainstorming)

1. **Grain for FB/IG in `post_daily_facts`:** one row per post, `date` = publish date, holding the latest lifetime metrics, clobbered each run. This is exactly how the 295/296 backfill already used the Airtable Posts data (engagement grouped by publish date), so future backfills reproduce the account rollup with a simple `GROUP BY date`. (Rejected: one-row-per-post-per-day snapshot — bloats the table and mixes cumulative metrics with Pinterest's additive daily rows in the same table, a query footgun.)
2. **`post_id` is platform-prefixed** — `<platform>_<rawId>` (e.g. `instagram_178…`, `facebook_…`), matching Pinterest's `pinterest_<id>`. Cross-platform uniqueness in a shared table; 0 existing FB/IG rows so no compatibility cost. The Airtable Posts write keeps the raw id (unchanged).
3. **No DB migration.** `post_daily_facts` already carries every FB/IG column (`likes`, `comments`, `shares`, `saves`, `reach`, `engagement`, `impressions`, `link_clicks`, `video_views`, `profile_visits`, `reposts`, `skip_rate`, `impressions_source`, `reach_source`, `data_status`). Pinterest-only columns (`pin_clicks`, `mrc_view_count`, `near_complete_views`) are omitted from the FB/IG INSERT and keep their table defaults.
4. **Per-platform settle windows:** `FB_SETTLE_DAYS = 3` (90% within 72h; up from today's 2), `IG_SETTLE_DAYS = 14`. Named constants, tunable.
5. **Hard constraint on the IG window:** posts are fetched for the **last 30 days** and the account writer re-emits ~30d. A settle window ≥ the 30d re-emit window would leave a row stuck `pending` forever (it stops being re-emitted before it ages past the threshold). So `IG_SETTLE_DAYS` **must stay well under 30** — 14 is safe and captures the bulk of Reel accrual. This rules out the ticket's literal "2–6 weeks" for the *settle threshold* (that is the full-accrual tail, not the point at which a row is trustworthy enough to compare).
6. **Dashboard treatment of unsettled ER: drop, not dim.** The ER comparison plots/averages only settled data. Recent unsettled days are absent from the ER trend + Avg-ER bar (they fill in automatically as they settle on later runs). Chosen over dimming because a greyed line still invites eyeballing a not-yet-real number.
7. **The ER trend and the Avg-ER bar have different settle sources** (found during design, `PlatformCompare.tsx`): the **ER trend** reads `account_daily_facts` rows (via the mis-named `dailyMetrics` prop = `filteredAccountFacts`), which **carry `data_status`** — so the trend filters on the writer's authoritative stamp. The **Avg-ER bar** is `weightedEngagementRate(platformPosts)`, derived from the **posts** prop, which has **no `data_status`** (neither the Airtable Posts write nor its mapper carries it). So the Avg-ER filter uses a small **client-side settle helper** keyed on post publish-date age + platform. Consequence: the FB/IG settle-window constants (3/14) are **duplicated** — once in the n8n writer, once in the dashboard helper — because the two run in separate runtimes and cannot share code. Accepted and documented; the boundary is ±1 day fuzzy anyway. (Rejected: repointing the dashboard `posts` source to `post_daily_facts` to inherit `data_status` — that is the reader-repoint the WEBDEV-228 plan deliberately avoided, out of scope here.)

---

## 3. Architecture

### A. Writer — `bootle-n8n`, `social-data-refresher__jKL4KjIiWyea6dyM.json`

**A1. Platform-aware settle window (352 core).** In the `Fetch Social Data` code node, replace the global `SETTLE_DAYS = 2` / `dataStatusFor(dateStr)` with:

```js
const FB_SETTLE_DAYS = 3;   // FB: ~90% of lifetime within ~72h
const IG_SETTLE_DAYS = 14;  // IG Reels front-load accrual in ~2 weeks; MUST stay < 30d fetch/re-emit window
function settleDaysFor(platform) {
  return String(platform).toLowerCase() === 'instagram' ? IG_SETTLE_DAYS : FB_SETTLE_DAYS;
}
function dataStatusFor(dateStr, platform) {
  const a = new Date(dateStr + 'T00:00:00Z');
  const t = new Date(today + 'T00:00:00Z');
  const ageDays = Math.floor((t.getTime() - a.getTime()) / 86400000);
  return ageDays > settleDaysFor(platform) ? 'settled' : 'pending';
}
```

Update all three callsites to pass platform:
- IG account-row build: `dataStatusFor(d, 'instagram')`
- FB account-row build: `dataStatusFor(d, 'facebook')`
- WoW-alert settled-days filter (per-platform loop): `dataStatusFor(m.Date, platformName)` — normalise `platformName` to lower-case. Consequence: IG's settled-day pool shrinks (WoW alerts shift to matured data). Accepted — comparing WoW on unsettled IG data produces false REACH_DECLINE/ER_DROP alerts, which is precisely what 352 wants gone.

**A2. Post `data_status` (feeds 351).** In the two `posts.push({...})` blocks in `Fetch Social Data`, add `'data_status': dataStatusFor(<publishDate>, <platform>)` (publish date = the `Published At` date portion). This keeps the settle definition in one place; the Airtable `Save Posts` write ignores the extra key.

**A3. New Supabase post-facts writer (351).** Tap the existing `Split Posts` output (Airtable `Save Posts` path untouched):

```
Split Posts ─┬─→ Save Posts                     (Airtable — UNCHANGED)
             └─→ Build Post Facts  →  SB Build: Save Post Facts  →  SB Upsert: Save Post Facts
```

- **`Build Post Facts`** (new hand-written code node): for each post from `Split Posts`, emit the contract-shaped object — prefixed `Post ID` (`<platform>_<rawId>`), `Snapshot Key` (= prefixed `Post ID`, one row per post), `Date` (= `Published At` date portion), pass-through metrics, `Impressions Source`/`Reach Source` = `lifetime_real`/(`lifetime_real` or `null`), and the pre-computed `data_status`. Skip any post missing `Post ID` or `Published At`.
- **`SB Build: Save Post Facts`** (new generated code node): body regenerated by `npm run inline` from a new `post_daily_facts_fbig` contract.
- **`SB Upsert: Save Post Facts`** (new postgres node): `executeQuery {{ $json.query }}`, same Supabase credential as the other `SB Upsert:` nodes.

**A4. New contract `post_daily_facts_fbig`** in `lib/social-contract/tableContracts.mjs`:
- `schemaTable: 'social.post_daily_facts'`, `conflictKey: 'snapshot_key'`, `conflictAction: 'update'`, `dedup: 'map'`, `nowStyle: 'join'`.
- Columns (all `clobber`): `snapshot_key, post_id, platform, date, impressions, impressions_source, reach, reach_source, likes, comments, shares, saves, reposts, link_clicks, profile_visits, engagement, video_views, skip_rate, data_status, updated_at(now)`. Omit `pin_clicks / mrc_view_count / near_complete_views` (Pinterest-only; table defaults apply on insert, untouched on update).
- Register in `CONTRACTS` + `FIXTURE_KEYS`, and add a `TARGETS` entry in `scripts/inline-contract.mjs` (`workflowFile: social-data-refresher…`, `nodeName: 'SB Build: Save Post Facts'`, `variant: 'post_daily_facts_fbig'`).

### B. Reader — `social-dashboard`

**B1a. ER trend lines — filter account rows by `data_status` (≈ lines 276–299).** The trend reads `account_daily_facts` rows from `metricsMap` (built from the `dailyMetrics` prop = `filteredAccountFacts`). These rows carry `data_status` under the snake-case key `fields["data_status"]` (confirmed: `supabaseMappers` maps `["data_status","data_status"]`; `MethodologyContent.tsx:277` already reads it that way). For each platform's series, blank a row's `"Engagement Rate"` and `"Engagement Rate Followers"` to `null` when `data_status !== 'settled'`. Because the chart already uses `spanGaps:false`, unsettled recent days render as a gap → IG's ER line ends ~14d before today, FB's ~3d.

**B1b. Avg-ER bar — filter posts by a client-side settle helper (≈ line 235 / 398).** `avgER` is `weightedEngagementRate(platformPosts) * 100`, derived from the `posts` prop, which has **no** `data_status`. Add a pure helper `isPostSettled(post, today)` (per-platform windows from a single dashboard constants module `FB_SETTLE_DAYS=3 / IG_SETTLE_DAYS=14`, mirror-commented against the writer), and compute `avgER = weightedEngagementRate(platformPosts.filter(p => isPostSettled(p, today))) * 100`. Publish date comes from the post's `"Published At"` / `"Snapshot Date"` field; platform from `"Platform"`.

Scope strictly to the ER comparison (trend + Avg-ER). Volume charts (followers/reach/impressions), per-post tables (`PostScorecardTable`, `PostDrilldownPanel`), and every other panel are unchanged.

**B2. `MethodologyContent.tsx` — honest copy.** Update the settle explainer (line ~90 "settle over ~1-2 days"; line ~578 same) to describe per-platform windows (FB ~3d, IG ~14d) and that the ER comparison shows settled data only.

---

## 4. Error handling / safety

- **Fetch failure:** `Fetch Social Data` already FAILS LOUD (throws) on the gate call. On a partial FB/IG failure `posts` is `[]` → `Build Post Facts` emits nothing → no post rows written (matches the Airtable `Save Posts` behaviour). Because writes clobber per post (not additive), a later successful run heals — no zero-clobber risk (we never write all-zero rows; posts missing id/date are skipped).
- **Re-emit healing:** a post row flips `pending → settled` automatically once it ages past its window, because it is re-emitted every run through the 30d fetch window (`IG_SETTLE_DAYS=14 < 30`). Same mechanism already covers the account rows' ~30d re-emit.
- **Dashboard:** dropping unsettled rows never errors on empty — if a platform has no settled ER in range the line is simply absent (existing null/gap handling).

---

## 5. Testing

- **`bootle-n8n`:** add golden fixtures for the new variant (`nodes.json` entry + input fixture + `sql/social_data_refresher__SB_Build__Save_Post_Facts.sql`), run `npm run inline`, keep `npm test` green (canonicalize / secret-scan / diff / put-body + social-contract golden tests). Add a focused unit check that `dataStatusFor` returns `pending` for a 5-day-old IG date and `settled` for a 5-day-old FB date.
- **`social-dashboard`:** (B1a) `PlatformCompare` unit test — an account row with `data_status:'pending'` produces a `null` (gap) in the ER trend series; a `'settled'` row produces its value. (B1b) `isPostSettled` unit test — a 5-day-old IG post is unsettled (excluded from Avg-ER), a 20-day-old IG post is settled; a 5-day-old FB post is settled. Keep existing `correctnessChecks` / `supabaseMappers` / `PlatformCompare` tests green.

---

## 6. Deploy & verification (Tier 3, phased)

**Phase 1 — writer (`bootle-n8n`):** repo → PR (diff is the review) → deep multi-lens review → `npm run deploy -- jKL4KjIiWyea6dyM PUT` → **manual schedule re-arm** (Active OFF→ON) → verify next run: (a) FB/IG rows now present in `social.post_daily_facts` with prefixed `post_id` and publish-date `date`; (b) recent IG account rows carry `data_status='pending'`, older ones `settled`; (c) FB settles at 3d.

**Phase 2 — dashboard (`social-dashboard`):** PR → review → merge → confirm on preview/prod that the ER comparison IG line ends ~14d back, FB ~3d back, and the Avg-ER bar no longer includes the immature IG tail. Reproduce the bias fix: pick an IG day inside the window and confirm it is absent from the ER comparison until it ages past 14d.

---

## 7. Out of scope

- Retiring the Airtable `Save Posts` write (separate retirement once the Supabase path is proven — do not remove it here).
- Backfilling historical FB/IG post rows into `post_daily_facts` (this ticket is "going forward"; the 295/296 account history is already repaired). A backfill becomes trivial later from the same daily writer if wanted.
- Pinterest settle behaviour (already stores READY days only; unchanged).
- Any change to the ER *definition* (unified in 295/296) — this is the timing/honesty layer only.
