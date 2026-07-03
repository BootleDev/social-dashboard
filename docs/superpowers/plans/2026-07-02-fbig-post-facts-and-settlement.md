# FB/IG post-facts persistence + per-platform settlement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist FB/IG per-post facts to `social.post_daily_facts` (WEBDEV-351) and make FB-vs-IG engagement-rate comparison honest via per-platform settle windows (WEBDEV-352).

**Architecture:** Additive n8n writer node chain off the existing `Split Posts` stream (Airtable path untouched) + a new `post_daily_facts_fbig` social-contract variant; a platform-aware settle window driving `data_status`; and a dashboard change that drops unsettled data from the ER comparison. Two repos, two deploy phases.

**Tech Stack:** n8n (JSON workflows + generated Code nodes), Node ESM social-contract lib, vitest (both repos), Postgres (Supabase `social` schema), Next.js/React + Chart.js (dashboard).

**Spec:** `social-dashboard/docs/superpowers/specs/2026-07-02-fbig-post-facts-and-settlement-design.md`

## Global Constraints

- **Repo paths:** bootle-n8n = `~/Projects/Bootle/shared/dev/bootle-n8n`; social-dashboard = `~/Projects/Bootle/shared/dev/social-dashboard`.
- **n8n change flow (never bypass):** edit repo → PR → `npm run deploy -- <id> PUT` → manual schedule re-arm. NEVER hand-edit a generated `SB Build:` node body — edit `lib/social-contract/` + run `npm run inline`.
- **Settle windows (verbatim):** `FB_SETTLE_DAYS = 3`, `IG_SETTLE_DAYS = 21`. IG must stay under the ~30-day fetch/re-emit window (see spec decision 5). These are duplicated in the n8n writer and the dashboard (separate runtimes) — mirror-comment both.
- **`post_id` is platform-prefixed:** `<platform>_<rawId>` (e.g. `instagram_178…`).
- **No DB migration** — `social.post_daily_facts` already has every column used.
- **Tier 3** — deep adversarial review before each merge; verify by reproduction after deploy.
- **Do NOT** remove the Airtable `Save Posts` write, backfill history, or change the ER definition (all out of scope, spec §7).
- **Never commit to main.** Work on `webdev-351-352-fbig-post-facts-settlement` (social-dashboard, exists) and a matching branch in bootle-n8n.

---

# PHASE 1 — Writer (`bootle-n8n`)

Branch: create `webdev-351-352-fbig-post-facts` in bootle-n8n.

```bash
cd ~/Projects/Bootle/shared/dev/bootle-n8n && git checkout main && git pull --ff-only && git checkout -b webdev-351-352-fbig-post-facts
```

### Task 1: Add the `post_daily_facts_fbig` contract

**Files:**
- Modify: `lib/social-contract/tableContracts.mjs` (add contract + `CONTRACTS` + `FIXTURE_KEYS`)
- Test: `test/social-contract/contracts.test.mjs` (bump 10→11; add structural test)

**Interfaces:**
- Produces: `CONTRACTS.post_daily_facts_fbig` (schemaTable `social.post_daily_facts`, conflictKey `snapshot_key`, dedup `map`, 20 columns all `clobber`); `FIXTURE_KEYS.post_daily_facts_fbig = 'social_data_refresher__SB_Build__Save_Post_Facts'`.

- [ ] **Step 1: Update the two count assertions to 11 (failing test first).** In `test/social-contract/contracts.test.mjs` change `expect(Object.keys(CONTRACTS)).toHaveLength(10);` → `toHaveLength(11);` and `expect(Object.keys(FIXTURE_KEYS)).toHaveLength(10);` → `toHaveLength(11);`. Add a new structural test after the `post_daily_facts_pinterest` block:

```js
  it('post_daily_facts_fbig is map dedup with 20 clobber columns on snapshot_key', () => {
    const c = CONTRACTS.post_daily_facts_fbig;
    expect(c.schemaTable).toBe('social.post_daily_facts');
    expect(c.conflictKey).toBe('snapshot_key');
    expect(c.dedup).toBe('map');
    expect(c.conflictAction).toBe('update');
    expect(c.columns).toHaveLength(20);
    // every non-key, non-now column clobbers (latest lifetime wins each run)
    for (const col of c.columns) {
      if (col.name === 'snapshot_key' || col.type === 'now') continue;
      expect(col.onConflict, col.name).toBe('clobber');
    }
    // Pinterest-only columns are absent
    const names = c.columns.map(x => x.name);
    expect(names).not.toContain('pin_clicks');
    expect(names).not.toContain('mrc_view_count');
    expect(names).not.toContain('near_complete_views');
  });
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd ~/Projects/Bootle/shared/dev/bootle-n8n && npx vitest run test/social-contract/contracts.test.mjs`
Expected: FAIL — `post_daily_facts_fbig` undefined / lengths are 10.

- [ ] **Step 3: Add the contract.** In `lib/social-contract/tableContracts.mjs`, after the `post_daily_facts_pinterest` const, add:

```js
/**
 * post_daily_facts_fbig
 * Source: social-data-refresher / "SB Build: Save Post Facts" (WEBDEV-351)
 * Table:  social.post_daily_facts
 * Dedup:  Map on snapshot_key
 * Grain:  one row per post, date = publish date, latest lifetime metrics
 *         (clobber each run). Pinterest-only columns (pin_clicks,
 *         mrc_view_count, near_complete_views) are omitted — table defaults
 *         apply on insert, untouched on update.
 */
const post_daily_facts_fbig = freeze({
  schemaTable: 'social.post_daily_facts',
  conflictKey: 'snapshot_key',
  conflictAction: 'update',
  dedup: 'map',
  columns: [
    col('snapshot_key',       'str',  'clobber', 'Snapshot Key'),
    col('post_id',            'str',  'clobber', 'Post ID'),
    col('platform',           'str',  'clobber', 'Platform'),
    col('date',               'str',  'clobber', 'Date'),
    col('impressions',        'num',  'clobber', 'Impressions'),
    col('impressions_source', 'str',  'clobber', 'Impressions Source'),
    col('reach',              'num',  'clobber', 'Reach'),
    col('reach_source',       'str',  'clobber', 'Reach Source'),
    col('likes',              'num',  'clobber', 'Likes'),
    col('comments',           'num',  'clobber', 'Comments'),
    col('shares',             'num',  'clobber', 'Shares'),
    col('saves',              'num',  'clobber', 'Saves'),
    col('reposts',            'num',  'clobber', 'Reposts'),
    col('link_clicks',        'num',  'clobber', 'Link Clicks'),
    col('profile_visits',     'num',  'clobber', 'Profile Visits'),
    col('engagement',         'num',  'clobber', 'Engagement'),
    col('video_views',        'num',  'clobber', 'Video Views'),
    col('skip_rate',          'num',  'clobber', 'Skip Rate'),
    col('data_status',        'str',  'clobber', 'data_status'),
    col('updated_at',         'now',  'clobber'),
  ],
});
```

Add `post_daily_facts_fbig,` to the `CONTRACTS` object and `post_daily_facts_fbig: 'social_data_refresher__SB_Build__Save_Post_Facts',` to `FIXTURE_KEYS`.

- [ ] **Step 4: Run — expect PASS.**

Run: `npx vitest run test/social-contract/contracts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/social-contract/tableContracts.mjs test/social-contract/contracts.test.mjs
git commit -m "feat(social-contract): add post_daily_facts_fbig contract (WEBDEV-351)"
```

---

### Task 2: Add the three workflow nodes + codegen target + golden fixtures

**Files:**
- Modify: `scripts/inline-contract.mjs` (add `TARGETS` entry)
- Modify: `workflows/social-data-refresher__jKL4KjIiWyea6dyM.json` (add 3 nodes + connections)
- Modify: `test/social-contract/fixtures/nodes.json`, add `test/social-contract/fixtures/inputs/social_data_refresher__SB_Build__Save_Post_Facts.json` and `.../sql/…Save_Post_Facts.sql`

**Interfaces:**
- Consumes: `CONTRACTS.post_daily_facts_fbig` (Task 1).
- Produces: nodes `Build Post Facts` (code), `SB Build: Save Post Facts` (generated code), `SB Upsert: Save Post Facts` (postgres) wired `Split Posts → Build Post Facts → SB Build: Save Post Facts → SB Upsert: Save Post Facts`.

- [ ] **Step 1: Add the codegen target.** In `scripts/inline-contract.mjs` `TARGETS`, append:

```js
  {
    workflowFile: 'social-data-refresher__jKL4KjIiWyea6dyM.json',
    nodeName:     'SB Build: Save Post Facts',
    variant:      'post_daily_facts_fbig',
  },
```

- [ ] **Step 2: Add the three nodes to the workflow JSON.** In `workflows/social-data-refresher__jKL4KjIiWyea6dyM.json`, add to the `nodes` array (place `jsCode` for `SB Build: Save Post Facts` as an empty string — `npm run inline` fills it in Step 4). `Build Post Facts` jsCode (this node owns ALL post_daily_facts derivation incl. the settle window, so it is unit-testable in Task 3):

```js
// Build Post Facts (WEBDEV-351/352) — transform Split Posts items into
// social.post_daily_facts rows for FB/IG. One row per post, date = publish
// date, latest lifetime metrics. post_id/snapshot_key platform-prefixed.
// data_status is stamped here with the per-platform settle window so it is
// unit-testable. Airtable "Save Posts" is a separate branch, untouched.
const FB_SETTLE_DAYS = 3;    // FB: ~90% of lifetime within ~72h
const IG_SETTLE_DAYS = 21;   // IG Reels; MUST stay under the ~30d fetch window (spec decision 5)
const today = new Date().toISOString().split('T')[0];

function settleDaysFor(platform) {
  return String(platform).toLowerCase() === 'instagram' ? IG_SETTLE_DAYS : FB_SETTLE_DAYS;
}
function dataStatusFor(dateStr, platform) {
  const a = new Date(dateStr + 'T00:00:00Z');
  const t = new Date(today + 'T00:00:00Z');
  const ageDays = Math.floor((t.getTime() - a.getTime()) / 86400000);
  return ageDays > settleDaysFor(platform) ? 'settled' : 'pending';
}

const items = $input.all();
const out = [];
for (const item of items) {
  const p = item.json;
  if (!p || !p['Post ID'] || !p['Published At']) continue; // need id + publish date
  const platform = p['Platform'];
  const postId = platform + '_' + p['Post ID'];
  const date = String(p['Published At']).split('T')[0];
  const reach = (p['Reach'] === undefined ? null : p['Reach']);
  out.push({ json: {
    'Snapshot Key':       postId,           // one row per post
    'Post ID':            postId,
    'Platform':           platform,
    'Date':               date,
    'Impressions':        p['Impressions'] ?? 0,
    'Impressions Source': 'lifetime_real',
    'Reach':              reach,
    'Reach Source':       (reach === null ? 'null' : 'lifetime_real'),
    'Likes':              p['Likes'] ?? null,
    'Comments':           p['Comments'] ?? null,
    'Shares':             p['Shares'] ?? null,
    'Saves':              p['Saves'] ?? 0,
    'Reposts':            p['Reposts'] ?? null,
    'Link Clicks':        p['Link Clicks'] ?? null,
    'Profile Visits':     p['Profile Visits'] ?? null,
    'Engagement':         p['Engagement'] ?? null,
    'Video Views':        p['Video Views'] ?? 0,
    'Skip Rate':          p['Skip Rate'] ?? null,
    'data_status':        dataStatusFor(date, platform),
  }});
}
return out;
```

Node objects to add (clone typeVersion/credential from the existing `SB Upsert: Save Daily Facts`):

```json
{ "id": "build-post-facts", "name": "Build Post Facts", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [496, -176], "parameters": { "jsCode": "<the Build Post Facts code above>" } },
{ "id": "sb-build-post-facts", "name": "SB Build: Save Post Facts", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [688, -176], "parameters": { "jsCode": "" } },
{ "id": "sb-upsert-post-facts", "name": "SB Upsert: Save Post Facts", "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": [880, -176], "onError": "continueRegularOutput", "credentials": { "postgres": { "id": "ktHb9RTJ3tyGJIWK", "name": "Supabase Postgres (social)" } }, "parameters": { "operation": "executeQuery", "options": {}, "query": "{{ $json.query }}" } }
```

- [ ] **Step 3: Wire the connections.** In the workflow `connections` object: change `Split Posts` so its `main[0]` array contains BOTH the existing `Save Posts` entry AND a new `Build Post Facts` entry; add chains for the two new code/postgres links:

```json
"Split Posts": { "main": [[ { "node": "Save Posts", "type": "main", "index": 0 }, { "node": "Build Post Facts", "type": "main", "index": 0 } ]] },
"Build Post Facts": { "main": [[ { "node": "SB Build: Save Post Facts", "type": "main", "index": 0 } ]] },
"SB Build: Save Post Facts": { "main": [[ { "node": "SB Upsert: Save Post Facts", "type": "main", "index": 0 } ]] }
```

- [ ] **Step 4: Generate the SB Build body.**

Run: `npm run inline`
Expected: writes the generated `buildUpsert` body into `SB Build: Save Post Facts`. Confirm with `git diff --stat workflows/`.

- [ ] **Step 5: Create the input fixture.** Write `test/social-contract/fixtures/inputs/social_data_refresher__SB_Build__Save_Post_Facts.json` — the OUTPUT shape of `Build Post Facts` (2 rows: one settled FB, one FB with null reach to exercise the `NULL` formatter):

```json
[
  { "json": { "Snapshot Key": "facebook_100_1", "Post ID": "facebook_100_1", "Platform": "facebook", "Date": "2026-06-01", "Impressions": 1200, "Impressions Source": "lifetime_real", "Reach": 900, "Reach Source": "lifetime_real", "Likes": 40, "Comments": 5, "Shares": 3, "Saves": 0, "Reposts": 2, "Link Clicks": 11, "Profile Visits": null, "Engagement": 61, "Video Views": 0, "Skip Rate": null, "data_status": "settled" } },
  { "json": { "Snapshot Key": "instagram_200_2", "Post ID": "instagram_200_2", "Platform": "instagram", "Date": "2026-06-29", "Impressions": 500, "Impressions Source": "lifetime_real", "Reach": null, "Reach Source": "null", "Likes": 30, "Comments": 4, "Shares": 1, "Saves": 8, "Reposts": null, "Link Clicks": null, "Profile Visits": 12, "Engagement": 43, "Video Views": 500, "Skip Rate": null, "data_status": "pending" } }
]
```

- [ ] **Step 6: Capture the golden SQL fixture.** The capture harness (`fixtures/_capture-harness.mjs`) reads `nodes.json`, so first add the generated body to `nodes.json` under key `social_data_refresher__SB_Build__Save_Post_Facts` (copy the `jsCode` string now present in the workflow's `SB Build: Save Post Facts` node), then run the harness:

```bash
node -e "const wf=require('./workflows/social-data-refresher__jKL4KjIiWyea6dyM.json');const b=wf.nodes.find(n=>n.name==='SB Build: Save Post Facts').parameters.jsCode;const fs=require('fs');const p='test/social-contract/fixtures/nodes.json';const j=JSON.parse(fs.readFileSync(p));j['social_data_refresher__SB_Build__Save_Post_Facts']=b;fs.writeFileSync(p,JSON.stringify(j,null,2));console.log('nodes.json updated')"
node test/social-contract/fixtures/_capture-harness.mjs
```
Expected: `OK   social_data_refresher__SB_Build__Save_Post_Facts (rowCount=2)` and a new `sql/…Save_Post_Facts.sql`. Inspect it: an `INSERT INTO social.post_daily_facts (...) VALUES (...),(...) ON CONFLICT (snapshot_key) DO UPDATE SET ...` with the null-reach row rendering `NULL`.

- [ ] **Step 7: Run the whole social-contract suite — expect PASS.**

Run: `npx vitest run test/social-contract/`
Expected: PASS — `golden` (11 cases), `inline-drift` (11 targets), `inlined-bodies` (11), `contracts` all green.

- [ ] **Step 8: Commit.**

```bash
git add scripts/inline-contract.mjs workflows/social-data-refresher__jKL4KjIiWyea6dyM.json test/social-contract/fixtures/
git commit -m "feat(social-data-refresher): persist FB/IG post facts to post_daily_facts (WEBDEV-351)"
```

---

### Task 3: Unit-test `Build Post Facts` + make account-row settle window platform-aware

**Files:**
- Create: `test/build-post-facts.test.mjs`
- Modify: `workflows/social-data-refresher__jKL4KjIiWyea6dyM.json` (the `Fetch Social Data` node's `dataStatusFor`)

**Interfaces:**
- Consumes: `Build Post Facts` node jsCode (Task 2) via `new Function` eval (mirrors `inlined-bodies.test.mjs`).

- [ ] **Step 1: Write the failing test for `Build Post Facts`.** Create `test/build-post-facts.test.mjs`. It loads the node jsCode from the workflow, stubs `$input.all()`, and asserts derivation + the settle window. Use `today` injection by monkeypatching is not possible (node reads `new Date()`), so assert relative to a post published far in the past (always settled) and one published today (always pending):

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function runBuildPostFacts(posts) {
  const wf = JSON.parse(readFileSync(new URL('../workflows/social-data-refresher__jKL4KjIiWyea6dyM.json', import.meta.url)));
  const code = wf.nodes.find(n => n.name === 'Build Post Facts').parameters.jsCode;
  const $input = { all: () => posts.map(p => ({ json: p })) };
  const fn = new Function('$input', code + '\n//# sourceURL=BuildPostFacts');
  return fn($input);
}
const today = new Date().toISOString().split('T')[0];
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().split('T')[0];

describe('Build Post Facts', () => {
  it('prefixes id, sets snapshot_key/date, maps metrics', () => {
    const [row] = runBuildPostFacts([{ 'Post ID': '123', 'Platform': 'facebook', 'Published At': daysAgo(30) + 'T10:00:00+0000', 'Impressions': 100, 'Reach': 80, 'Likes': 5, 'Engagement': 9 }]).map(x => x.json);
    expect(row['Post ID']).toBe('facebook_123');
    expect(row['Snapshot Key']).toBe('facebook_123');
    expect(row['Date']).toBe(daysAgo(30));
    expect(row['Impressions']).toBe(100);
    expect(row['Reach Source']).toBe('lifetime_real');
  });
  it('tags null reach as reach_source null', () => {
    const [row] = runBuildPostFacts([{ 'Post ID': '9', 'Platform': 'instagram', 'Published At': daysAgo(1), 'Impressions': 5 }]).map(x => x.json);
    expect(row['Reach']).toBe(null);
    expect(row['Reach Source']).toBe('null');
  });
  it('settle window: FB=3d, IG=21d', () => {
    const rows = runBuildPostFacts([
      { 'Post ID': 'a', 'Platform': 'facebook', 'Published At': daysAgo(5) },   // FB 5>3 settled
      { 'Post ID': 'b', 'Platform': 'facebook', 'Published At': daysAgo(2) },   // FB 2<=3 pending
      { 'Post ID': 'c', 'Platform': 'instagram', 'Published At': daysAgo(10) }, // IG 10<=21 pending
      { 'Post ID': 'd', 'Platform': 'instagram', 'Published At': daysAgo(25) }, // IG 25>21 settled
    ]).map(x => x.json);
    expect(rows.map(r => r['data_status'])).toEqual(['settled', 'pending', 'pending', 'settled']);
  });
  it('skips posts missing id or publish date', () => {
    const rows = runBuildPostFacts([{ 'Platform': 'facebook', 'Published At': daysAgo(5) }, { 'Post ID': 'x', 'Platform': 'facebook' }]);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect PASS** (Build Post Facts already implemented in Task 2).

Run: `npx vitest run test/build-post-facts.test.mjs`
Expected: PASS. (If any fail, fix the `Build Post Facts` jsCode in the workflow, not the test.)

- [ ] **Step 3: Make the account-row settle window platform-aware.** In the `Fetch Social Data` node jsCode, replace the current settle block:

```js
const SETTLE_DAYS = 2;
function dataStatusFor(dateStr) {
  const a = new Date(dateStr + 'T00:00:00Z');
  const t = new Date(today + 'T00:00:00Z');
  const ageDays = Math.floor((t.getTime() - a.getTime()) / 86400000);
  return ageDays > SETTLE_DAYS ? 'settled' : 'pending';
}
```
with:

```js
// Per-platform settle window (WEBDEV-352). IG Reels accrue for weeks; FB
// settles in ~72h. IG_SETTLE_DAYS MUST stay under the ~30d fetch/re-emit
// window (spec decision 5). Mirrors Build Post Facts + the dashboard helper.
const FB_SETTLE_DAYS = 3;
const IG_SETTLE_DAYS = 21;
function dataStatusFor(dateStr, platform) {
  const a = new Date(dateStr + 'T00:00:00Z');
  const t = new Date(today + 'T00:00:00Z');
  const ageDays = Math.floor((t.getTime() - a.getTime()) / 86400000);
  const window = String(platform).toLowerCase() === 'instagram' ? IG_SETTLE_DAYS : FB_SETTLE_DAYS;
  return ageDays > window ? 'settled' : 'pending';
}
```

Then update the three callsites in `Fetch Social Data`:
- IG daily-facts push: `'data_status': dataStatusFor(d)` → `'data_status': dataStatusFor(d, 'instagram')`
- FB daily-facts push: `'data_status': dataStatusFor(d)` → `'data_status': dataStatusFor(d, 'facebook')`
- WoW-alert settled filter: `dataStatusFor(m.Date) === 'settled'` → `dataStatusFor(m.Date, platformName) === 'settled'` (this loop already has `platformName`; if it is title-case like `'Instagram'`, the `.toLowerCase()` inside handles it).

- [ ] **Step 4: Sanity — no other `dataStatusFor(` callsite lost its platform arg.**

Run: `node -e "const wf=require('./workflows/social-data-refresher__jKL4KjIiWyea6dyM.json');const c=wf.nodes.find(n=>n.name==='Fetch Social Data').parameters.jsCode;const m=[...c.matchAll(/dataStatusFor\(/g)];console.log('callsites:',m.length);const bad=[...c.matchAll(/dataStatusFor\([^,)]*\)/g)].map(x=>x[0]);console.log('single-arg (should be empty):',bad.filter(s=>!s.includes('function')))"`
Expected: `callsites: 4` (1 declaration + 3 calls), `single-arg (should be empty): []`.

- [ ] **Step 5: Run the full suite — expect PASS.**

Run: `npx vitest run`
Expected: PASS (contract suite + build-post-facts; the `Fetch Social Data` edit has no unit test but must not break existing tests).

- [ ] **Step 6: Commit.**

```bash
git add workflows/social-data-refresher__jKL4KjIiWyea6dyM.json test/build-post-facts.test.mjs
git commit -m "feat(social-data-refresher): per-platform settle window FB=3/IG=21 (WEBDEV-352)"
```

---

### Task 4: Review, deploy, verify (Phase 1 gate)

- [ ] **Step 1: Open the PR + deep review.** `git push -u origin webdev-351-352-fbig-post-facts`, open PR. Run `/code-review` (Tier 3, DB-on-serverless lens: fail-loud/zero-clobber; correctness of null formatting; connection wiring). Fix findings. The diff must be exactly: 1 contract, 1 TARGETS entry, 3 nodes + connections, 1 generated body, 3 fixtures, 2 test files, `Fetch Social Data` settle edit — nothing else.
- [ ] **Step 2: Merge, then deploy.**

```bash
npm run deploy -- jKL4KjIiWyea6dyM        # dry-run, inspect diff
npm run deploy -- jKL4KjIiWyea6dyM PUT     # writes + round-trip verifies
```

- [ ] **Step 3: Manual schedule re-arm.** n8n → Social Data Refresher → Active toggle OFF then ON. Confirm the next scheduled run fires (green light is not proof — check for a fresh execution).
- [ ] **Step 4: Verify by reproduction (after the next run).** Via Supabase MCP:

```sql
-- (a) FB/IG rows now land, prefixed, dated by publish date
select platform, count(*), min(date), max(date)
from social.post_daily_facts where platform in ('facebook','instagram') group by platform;
select post_id, snapshot_key, date, data_status from social.post_daily_facts
where platform in ('facebook','instagram') order by date desc limit 10;
-- (b) settle window honest: recent IG account rows pending, older settled
select date, data_status from social.account_daily_facts
where platform='instagram' and is_post_day order by date desc limit 25;
```
Expected: (a) FB/IG rows present, `post_id` like `instagram_…`, `snapshot_key = post_id`; (b) IG rows within 21d = `pending`, older = `settled`; FB flips at 3d.

- [ ] **Step 5: Sync local main + delete branch** (per git-workflow rules). Update memory `project-er-metric-rebuild-2026-06` marking 351 + the 352 writer half done.

---

# PHASE 2 — Reader (`social-dashboard`)

Branch `webdev-351-352-fbig-post-facts-settlement` already exists (holds the spec/plan). Gate Phase 2 on Phase 1 being deployed + verified (so `data_status` is honest in the data the dashboard reads).

### Task 5: Add the settle-window constants + `isPostSettled` helper

**Files:**
- Create: `src/lib/settlement.ts`
- Test: `src/lib/__tests__/settlement.test.ts`

**Interfaces:**
- Produces: `FB_SETTLE_DAYS`, `IG_SETTLE_DAYS`, `isPostSettled(post: AirtableRecord, today: string): boolean`.

- [ ] **Step 1: Write the failing test.** Create `src/lib/__tests__/settlement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPostSettled } from "@/lib/settlement";
import type { AirtableRecord } from "@/lib/utils";

const post = (platform: string, publishedDaysAgo: number): AirtableRecord => ({
  id: "x",
  fields: { Platform: platform, "Published At": new Date(Date.now() - publishedDaysAgo * 86400000).toISOString() },
  createdTime: "",
});
const today = new Date().toISOString().split("T")[0];

describe("isPostSettled", () => {
  it("FB settles after 3 days", () => {
    expect(isPostSettled(post("facebook", 5), today)).toBe(true);
    expect(isPostSettled(post("facebook", 2), today)).toBe(false);
  });
  it("IG settles after 21 days", () => {
    expect(isPostSettled(post("instagram", 10), today)).toBe(false);
    expect(isPostSettled(post("instagram", 25), today)).toBe(true);
  });
  it("non-FB/IG (pinterest) is never gated", () => {
    expect(isPostSettled(post("pinterest", 1), today)).toBe(true);
  });
  it("missing publish date is treated as settled (do not hide)", () => {
    expect(isPostSettled({ id: "x", fields: { Platform: "instagram" }, createdTime: "" }, today)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd ~/Projects/Bootle/shared/dev/social-dashboard && npx vitest run src/lib/__tests__/settlement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/lib/settlement.ts`:

```ts
import { str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

// MIRROR of the n8n writer settle window (social-data-refresher: Build Post
// Facts + Fetch Social Data). Kept in sync by hand — separate runtimes cannot
// share code. See spec 2026-07-02-fbig-post-facts-and-settlement-design.md §2.
export const FB_SETTLE_DAYS = 3;
export const IG_SETTLE_DAYS = 21;

/**
 * Is a FB/IG post old enough that its lifetime metrics have mostly settled?
 * Only gates instagram/facebook; every other platform returns true (not gated).
 * A post with no parseable publish date returns true (never hide data on a
 * missing field).
 */
export function isPostSettled(post: AirtableRecord, today: string): boolean {
  const platform = str(post.fields["Platform"]).toLowerCase();
  if (platform !== "instagram" && platform !== "facebook") return true;
  const published = str(post.fields["Published At"]) || str(post.fields["Snapshot Date"]);
  const day = published.split("T")[0];
  if (!day) return true;
  const ageDays = Math.floor(
    (new Date(today + "T00:00:00Z").getTime() - new Date(day + "T00:00:00Z").getTime()) / 86400000,
  );
  const window = platform === "instagram" ? IG_SETTLE_DAYS : FB_SETTLE_DAYS;
  return ageDays > window;
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npx vitest run src/lib/__tests__/settlement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/settlement.ts src/lib/__tests__/settlement.test.ts
git commit -m "feat(dashboard): add per-platform post settle helper (WEBDEV-352)"
```

---

### Task 6: Drop unsettled data from the ER comparison in `PlatformCompare`

**Files:**
- Modify: `src/components/PlatformCompare.tsx` (avgER ≈ line 235; ER trend ≈ lines 274–299)
- Test: `src/components/__tests__/PlatformCompare.test.tsx`

**Interfaces:**
- Consumes: `isPostSettled` (Task 5).

- [ ] **Step 1: Write the failing tests.** Append to `src/components/__tests__/PlatformCompare.test.tsx` (follow the file's existing render/fixture style). Two behaviours: (a) a `pending` recent IG account row produces a gap (null) in the IG ER trend series; (b) a `pending` recent IG post is excluded from Avg ER. If the existing tests assert on chart data via a mock of `react-chartjs-2`, reuse that mock; otherwise assert on a small extracted pure helper. Concretely, extract the two computations into testable module functions and test those:

```ts
// new tests target helpers erTrendSeries + avgERSettled (Step 3 extracts them)
import { erSeriesForPlatform, avgERSettled } from "@/components/platformCompareLogic";

it("blanks unsettled IG account rows in the ER series", () => {
  const dates = ["2026-06-01", "2026-06-29"];
  const rows = [
    { id: "1", fields: { Date: "2026-06-01", "Engagement Rate": 0.1, data_status: "settled" }, createdTime: "" },
    { id: "2", fields: { Date: "2026-06-29", "Engagement Rate": 0.2, data_status: "pending" }, createdTime: "" },
  ];
  expect(erSeriesForPlatform("instagram", rows, dates, "Engagement Rate")).toEqual([0.1, null]);
});
it("excludes unsettled posts from avg ER", () => {
  const today = "2026-06-30";
  const settledPost = { id: "a", fields: { Platform: "instagram", "Published At": "2026-06-01", Reach: 100, Engagement: 10 }, createdTime: "" };
  const freshPost = { id: "b", fields: { Platform: "instagram", "Published At": "2026-06-29", Reach: 100, Engagement: 1 }, createdTime: "" };
  expect(avgERSettled([settledPost, freshPost], today)).toBeCloseTo(0.1, 5);
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npx vitest run src/components/__tests__/PlatformCompare.test.tsx`
Expected: FAIL — `platformCompareLogic` module not found.

- [ ] **Step 3: Extract + implement the two helpers.** Create `src/components/platformCompareLogic.ts`:

```ts
import { alignToDateArrayNullable, weightedEngagementRate, str } from "@/lib/utils";
import { isPostSettled } from "@/lib/settlement";
import type { AirtableRecord } from "@/lib/utils";

// ER trend: for FB/IG, only settled account rows contribute; unsettled dates
// become gaps (null). Pinterest is not gated here (returned as-is).
export function erSeriesForPlatform(
  platform: string, metrics: AirtableRecord[], dates: string[], field: string,
): (number | null)[] {
  const p = platform.toLowerCase();
  const rows = (p === "instagram" || p === "facebook")
    ? metrics.filter((m) => str(m.fields["data_status"]) === "settled")
    : metrics;
  return alignToDateArrayNullable(rows, dates, field);
}

// Avg ER: reach-weighted over settled posts only (isPostSettled gates FB/IG).
export function avgERSettled(posts: AirtableRecord[], today: string): number {
  return weightedEngagementRate(posts.filter((post) => isPostSettled(post, today)));
}
```

Then wire them into `PlatformCompare.tsx`:
- Add imports: `import { erSeriesForPlatform, avgERSettled } from "./platformCompareLogic";` and compute `const today = new Date().toISOString().split("T")[0];` inside the component (top of the function body).
- avgER (≈ line 235): `avgER: weightedEngagementRate(platformPosts) * 100,` → `avgER: avgERSettled(platformPosts, today) * 100,`.
- ER trend (≈ lines 281 & 289): replace both
  `alignToDateArrayNullable(metrics, allDates, "Engagement Rate").map(toPct)` →
  `erSeriesForPlatform(key, metrics, allDates, "Engagement Rate").map(toPct)`, and the `"Engagement Rate Followers"` line likewise with `erSeriesForPlatform(key, metrics, allDates, "Engagement Rate Followers")`.

- [ ] **Step 4: Run — expect PASS.**

Run: `npx vitest run src/components/__tests__/PlatformCompare.test.tsx src/lib/__tests__/settlement.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite.**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests green (existing `PlatformCompare`, `supabaseMappers`, `correctnessChecks` still pass).

- [ ] **Step 6: Commit.**

```bash
git add src/components/PlatformCompare.tsx src/components/platformCompareLogic.ts src/components/__tests__/PlatformCompare.test.tsx
git commit -m "feat(dashboard): drop unsettled data from ER comparison, per-platform (WEBDEV-352)"
```

---

### Task 7: Honest methodology copy

**Files:**
- Modify: `src/components/MethodologyContent.tsx` (≈ line 90 and ≈ line 578)

- [ ] **Step 1: Update the settle explainer.** Change the copy that says days "settle over ~1-2 days" to per-platform reality. At ≈ line 90 (the `pending → settled` tag description) and ≈ line 578, use wording like: "Recent days arrive `pending` and settle over a per-platform window — ~3 days for Facebook, ~21 days for Instagram (Reels keep accruing for weeks). The Engagement-Rate comparison shows settled data only, so recent Instagram days appear once they've matured." Keep the surrounding JSX/markup intact — text only.

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/components/MethodologyContent.tsx
git commit -m "docs(dashboard): methodology copy for per-platform settle windows (WEBDEV-352)"
```

---

### Task 8: Review, deploy, verify (Phase 2 gate)

- [ ] **Step 1: Push + deep review.** `git push -u origin webdev-351-352-fbig-post-facts-settlement`, open PR. `/code-review` Tier 3 (correctness of the settled filter; that Pinterest is NOT gated; parity with the un-gated volume charts). Fix findings.
- [ ] **Step 2: Merge to main** (branch-protection merge per repo rules). Vercel auto-deploys.
- [ ] **Step 3: Verify on prod/preview by reproduction.** Open the dashboard → Platform Compare → Engagement Rate Comparison: the IG ER line ends ~21d before today, the FB line ~3d before; the Avg-ER bar no longer includes the immature IG tail. Cross-check: an IG post published <21d ago is absent from the ER comparison but still visible with its raw metrics in the per-post tables.
- [ ] **Step 4: Close tickets + sync.** Mark WEBDEV-351 and WEBDEV-352 Done with a short evidence comment (row counts + the before/after ER chart behaviour). Sync local main, delete both feature branches, update memory `project-er-metric-rebuild-2026-06`.

---

## Self-review notes

- **Spec coverage:** §3.A1→Task 3; §3.A2 (post data_status) relocated to `Build Post Facts` for testability→Task 2/3; §3.A3→Task 2; §3.A4→Task 1; §3.B1a→Task 6; §3.B1b→Tasks 5+6; §3.B2→Task 7; §4 error handling covered by Task 2 skip-guards + Task 4 verify; §5 testing→Tasks 1,3,5,6; §6 deploy→Tasks 4,8.
- **Type consistency:** `isPostSettled(post, today)` / `erSeriesForPlatform(platform, metrics, dates, field)` / `avgERSettled(posts, today)` used identically where referenced.
- **Deviation from spec noted:** post `data_status` is stamped in `Build Post Facts` (not `Fetch Social Data`) — identical behaviour, unit-testable. The account-row settle window still lives in `Fetch Social Data`.
