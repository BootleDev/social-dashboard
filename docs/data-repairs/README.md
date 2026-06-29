# Data repairs

One-time, manually-executed corrections to the canonical Supabase `social.*` store, kept here as an **audit record** (what ran, when, why, and how to roll back). These are NOT migrations and are not re-run by any tooling — they document a prod data mutation that already happened.

| File | Date | Ticket | What it did | Rollback |
|---|---|---|---|---|
| `2026-06-29-webdev-295-296-er-rebuild.sql` | 2026-06-29 | WEBDEV-295 / 296 | Re-stated all 107 settled FB+IG rows in `social.account_daily_facts` to **content-grain** engagement (engagement = per-post sum by publish date; `content_reach`; ER = round(eng/content_reach, 4); ERF; `is_post_day`; FB account-level engagement split into `fb_account_engagement`). Sourced deterministically from the Airtable Posts table; Pinterest never touched. Verified 0 reproducibility violations on prod. | Backup table `social.bak_adf_er_rebuild_20260629` (107 rows) — restore from it, then drop. Safe to drop the backup after a stability window. |

Going forward, the writer (bootle-n8n Social Data Refresher, `bootle-n8n#6`) produces these columns natively, and the WEBDEV-288 correctness monitor enforces them — so this repair should never need to run again.
