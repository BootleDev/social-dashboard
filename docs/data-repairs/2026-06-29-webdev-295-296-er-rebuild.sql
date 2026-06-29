-- =============================================================================
-- repair-v2.sql  --  ER rebuild: WEBDEV-295 (FB) / WEBDEV-296 (IG)
-- Generated : 2026-06-29
-- Source    : Airtable base app0oKaYjbWBcrqzH / table tbljDi7YY46pQkQGH (Posts)
--             Pull: Facebook + Instagram posts published 2026-05-03..2026-06-28
--             Aggregated by (platform, publish_date): SUM(Engagement), SUM(Reach), COUNT(*)
--             Note: one IG post 2026-06-19 has Reach=0 (stale); included as-is.
--             Note: IG 2026-06-26 has a post (eng=14, reach=1114) but the
--                   corresponding Supabase row is pending -- NOT in repair scope.
-- Target    : social.account_daily_facts
-- Scope     : settled rows WHERE platform IN ('facebook','instagram') ONLY.
--             Pinterest rows are NEVER touched.
-- Column semantics (see task spec for authoritative wording):
--   Post-day  : engagement=eng_sum, content_reach=reach_sum,
--               content_reach_source='post_sum',
--               content_engagement_source = platform-specific label,
--               engagement_rate = round(eng_sum / NULLIF(reach_sum,0), 6),
--               engagement_rate_followers = round(eng_sum / NULLIF(followers,0), 6),
--               is_post_day = true
--   No-post   : engagement=NULL, content_reach=NULL, content_reach_source=NULL,
--               content_engagement_source=NULL, engagement_rate=NULL,
--               engagement_rate_followers=NULL, is_post_day=false
--   FB always : fb_account_engagement = OLD engagement (captured before overwrite)
--   All rows  : restatement_log = '2026-06-29 ER rebuild WEBDEV-295/296 (Airtable post backfill)'
-- =============================================================================


-- ---------------------------------------------------------------------------
-- SECTION 1: Airtable aggregates (baked-in exact integers, no rounding)
-- ---------------------------------------------------------------------------
-- These VALUES were pulled 2026-06-29 from Airtable Posts table.
-- Format: (platform, publish_date, eng_sum, reach_sum, n_posts)
-- IG 2026-06-19: two posts (one with Reach=0, one with Reach=189)
--   eng_sum = 0+18 = 18, reach_sum = 0+189 = 189 → ER is non-null (18/189)
-- IG 2026-06-26: pending row in Supabase → excluded from settled repair scope.

-- (Used as CTE in both the dry-run SELECT and UPDATE statements below.)

-- ---------------------------------------------------------------------------
-- SECTION 2: DRY-RUN SELECT  (READ-ONLY — safe to execute any time)
-- Shows before/after for every settled FB+IG row.
-- ---------------------------------------------------------------------------

WITH at_aggs AS (
  SELECT * FROM (VALUES
    -- Facebook
    ('facebook', DATE '2026-05-07',  1,   14, 1),
    ('facebook', DATE '2026-05-08',  3,   69, 2),
    ('facebook', DATE '2026-05-22',  1,    4, 1),
    ('facebook', DATE '2026-05-25',  0,  152, 1),
    ('facebook', DATE '2026-06-02',  0,  200, 1),
    ('facebook', DATE '2026-06-08',  0,  202, 1),
    ('facebook', DATE '2026-06-11',  2,  295, 1),
    ('facebook', DATE '2026-06-12',  3,  217, 1),
    ('facebook', DATE '2026-06-13',  0,  200, 1),
    ('facebook', DATE '2026-06-16',  4,  281, 1),
    ('facebook', DATE '2026-06-20',  0,  124, 1),
    -- Instagram (IG 2026-06-26 omitted — pending row)
    ('instagram', DATE '2026-05-04',  6,    9, 1),
    ('instagram', DATE '2026-05-05',  0,  113, 1),
    ('instagram', DATE '2026-05-07', 32,  607, 1),
    ('instagram', DATE '2026-05-08', 51, 1217, 2),
    ('instagram', DATE '2026-05-17', 33, 1378, 1),
    ('instagram', DATE '2026-05-19',  1,  104, 1),
    ('instagram', DATE '2026-05-22', 19,  227, 1),
    ('instagram', DATE '2026-05-24',  0,  104, 1),
    ('instagram', DATE '2026-05-25', 37,  315, 1),
    ('instagram', DATE '2026-05-26',  0,   79, 1),
    ('instagram', DATE '2026-05-27',  0,  111, 1),
    ('instagram', DATE '2026-05-28', 12,  231, 1),
    ('instagram', DATE '2026-06-01',  5,  144, 1),
    ('instagram', DATE '2026-06-02', 31,  455, 1),
    ('instagram', DATE '2026-06-08', 45, 1539, 1),
    ('instagram', DATE '2026-06-09',  2,  148, 1),
    ('instagram', DATE '2026-06-10', 34, 1896, 3),
    ('instagram', DATE '2026-06-11', 26,  605, 1),
    ('instagram', DATE '2026-06-12', 25,  998, 1),
    ('instagram', DATE '2026-06-19', 18,  189, 2),
    ('instagram', DATE '2026-06-23', 28, 1322, 1)
  ) AS t(platform, publish_date, eng_sum, reach_sum, n_posts)
),
base AS (
  SELECT
    f.platform,
    f.date,
    f.followers,
    f.engagement                  AS eng_now,
    f.engagement_rate             AS er_now,
    f.content_reach               AS cr_now,
    f.is_post_day                 AS post_day_now,
    f.fb_account_engagement       AS fb_acct_eng_now,
    -- proposed values
    a.eng_sum,
    a.reach_sum,
    a.n_posts,
    (a.platform IS NOT NULL)      AS will_be_post_day,
    -- proposed engagement (post-day → eng_sum; no-post → NULL)
    CASE WHEN a.platform IS NOT NULL THEN a.eng_sum         ELSE NULL END AS eng_new,
    -- proposed content_reach
    CASE WHEN a.platform IS NOT NULL THEN a.reach_sum       ELSE NULL END AS cr_new,
    -- proposed ER (post-day → computed; no-post → NULL)
    CASE WHEN a.platform IS NOT NULL
         THEN round(a.eng_sum::numeric / NULLIF(a.reach_sum, 0), 6)
         ELSE NULL END                                                    AS er_new,
    -- proposed ER_followers (post-day → computed; no-post → NULL)
    CASE WHEN a.platform IS NOT NULL
         THEN round(a.eng_sum::numeric / NULLIF(f.followers, 0), 6)
         ELSE NULL END                                                    AS er_followers_new,
    -- proposed fb_account_engagement (FB only, ALL rows → capture old engagement)
    CASE WHEN f.platform = 'facebook' THEN f.engagement ELSE NULL END    AS fb_acct_eng_new
  FROM social.account_daily_facts f
  LEFT JOIN at_aggs a
         ON a.platform = f.platform AND a.publish_date = f.date
  WHERE f.platform IN ('facebook', 'instagram')
    AND f.data_status = 'settled'
)
SELECT
  platform,
  date,
  -- engagement
  eng_now,
  eng_new,
  -- engagement_rate
  er_now,
  er_new,
  -- engagement_rate_followers (new only — currently always NULL)
  er_followers_new,
  -- content_reach
  cr_now,
  cr_new,
  -- is_post_day
  post_day_now,
  will_be_post_day AS post_day_new,
  -- fb_account_engagement
  fb_acct_eng_now,
  fb_acct_eng_new,
  -- meta
  followers,
  n_posts
FROM base
ORDER BY platform, date;


-- ---------------------------------------------------------------------------
-- SECTION 3: UPDATE statements  (NOT executed here — controller sign-off required)
-- ---------------------------------------------------------------------------
-- IMPORTANT: Run SECTION 2 (dry-run SELECT) and verify before executing these.
-- Execute in a transaction with a rollback check:
--   BEGIN;
--   <UPDATE statements below>
--   SELECT platform, date, engagement, engagement_rate, content_reach, is_post_day,
--          fb_account_engagement, restatement_log
--   FROM social.account_daily_facts
--   WHERE platform IN ('facebook','instagram') AND data_status = 'settled'
--   ORDER BY platform, date;
--   -- If correct: COMMIT;  If not: ROLLBACK;
-- ---------------------------------------------------------------------------

-- UPDATE A: Facebook settled rows
-- fb_account_engagement = OLD engagement (Postgres evaluates all SET RHS against the OLD row)
-- engagement            = post-level eng_sum on post-days, NULL on no-post days
-- All other post-day columns written only if a match exists in at_aggs.
UPDATE social.account_daily_facts AS f
SET
  -- Capture account-level engagement BEFORE overwriting (evaluated against OLD row)
  fb_account_engagement       = f.engagement,
  -- Post-day columns (NULL if no post that day)
  engagement                  = a.eng_sum,
  content_reach               = a.reach_sum,
  content_reach_source        = CASE WHEN a.eng_sum IS NOT NULL THEN 'post_sum'              ELSE NULL END,
  content_engagement_source   = CASE WHEN a.eng_sum IS NOT NULL THEN 'fb_post_engagements'  ELSE NULL END,
  engagement_rate             = CASE WHEN a.eng_sum IS NOT NULL
                                     THEN round(a.eng_sum::numeric / NULLIF(a.reach_sum, 0), 6)
                                     ELSE NULL END,
  engagement_rate_followers   = CASE WHEN a.eng_sum IS NOT NULL
                                     THEN round(a.eng_sum::numeric / NULLIF(f.followers, 0), 6)
                                     ELSE NULL END,
  is_post_day                 = (a.eng_sum IS NOT NULL),
  restatement_log             = '2026-06-29 ER rebuild WEBDEV-295/296 (Airtable post backfill)'
FROM (VALUES
    (DATE '2026-05-07',  1,   14, 1),
    (DATE '2026-05-08',  3,   69, 2),
    (DATE '2026-05-22',  1,    4, 1),
    (DATE '2026-05-25',  0,  152, 1),
    (DATE '2026-06-02',  0,  200, 1),
    (DATE '2026-06-08',  0,  202, 1),
    (DATE '2026-06-11',  2,  295, 1),
    (DATE '2026-06-12',  3,  217, 1),
    (DATE '2026-06-13',  0,  200, 1),
    (DATE '2026-06-16',  4,  281, 1),
    (DATE '2026-06-20',  0,  124, 1)
) AS a(publish_date, eng_sum, reach_sum, n_posts)
WHERE f.platform    = 'facebook'
  AND f.data_status = 'settled'
  AND f.date        = a.publish_date;

-- For FB no-post days: zero out engagement/ER columns (fb_account_engagement still captured above)
-- This catches FB settled rows where engagement/ER existed but no Airtable post was found.
UPDATE social.account_daily_facts AS f
SET
  fb_account_engagement       = f.engagement,
  engagement                  = NULL,
  content_reach               = NULL,
  content_reach_source        = NULL,
  content_engagement_source   = NULL,
  engagement_rate             = NULL,
  engagement_rate_followers   = NULL,
  is_post_day                 = false,
  restatement_log             = '2026-06-29 ER rebuild WEBDEV-295/296 (Airtable post backfill)'
WHERE f.platform    = 'facebook'
  AND f.data_status = 'settled'
  AND f.date NOT IN (
    DATE '2026-05-07', DATE '2026-05-08', DATE '2026-05-22', DATE '2026-05-25',
    DATE '2026-06-02', DATE '2026-06-08', DATE '2026-06-11', DATE '2026-06-12',
    DATE '2026-06-13', DATE '2026-06-16', DATE '2026-06-20'
  );

-- UPDATE B: Instagram settled rows (post-days)
UPDATE social.account_daily_facts AS f
SET
  engagement                  = a.eng_sum,
  content_reach               = a.reach_sum,
  content_reach_source        = 'post_sum',
  content_engagement_source   = 'ig_total_interactions',
  engagement_rate             = round(a.eng_sum::numeric / NULLIF(a.reach_sum, 0), 6),
  engagement_rate_followers   = round(a.eng_sum::numeric / NULLIF(f.followers, 0), 6),
  is_post_day                 = true,
  restatement_log             = '2026-06-29 ER rebuild WEBDEV-295/296 (Airtable post backfill)'
FROM (VALUES
    (DATE '2026-05-04',  6,    9, 1),
    (DATE '2026-05-05',  0,  113, 1),
    (DATE '2026-05-07', 32,  607, 1),
    (DATE '2026-05-08', 51, 1217, 2),
    (DATE '2026-05-17', 33, 1378, 1),
    (DATE '2026-05-19',  1,  104, 1),
    (DATE '2026-05-22', 19,  227, 1),
    (DATE '2026-05-24',  0,  104, 1),
    (DATE '2026-05-25', 37,  315, 1),
    (DATE '2026-05-26',  0,   79, 1),
    (DATE '2026-05-27',  0,  111, 1),
    (DATE '2026-05-28', 12,  231, 1),
    (DATE '2026-06-01',  5,  144, 1),
    (DATE '2026-06-02', 31,  455, 1),
    (DATE '2026-06-08', 45, 1539, 1),
    (DATE '2026-06-09',  2,  148, 1),
    (DATE '2026-06-10', 34, 1896, 3),
    (DATE '2026-06-11', 26,  605, 1),
    (DATE '2026-06-12', 25,  998, 1),
    (DATE '2026-06-19', 18,  189, 2),
    (DATE '2026-06-23', 28, 1322, 1)
) AS a(publish_date, eng_sum, reach_sum, n_posts)
WHERE f.platform    = 'instagram'
  AND f.data_status = 'settled'
  AND f.date        = a.publish_date;

-- Instagram no-post days: clear engagement/ER (most already NULL; included for completeness)
UPDATE social.account_daily_facts AS f
SET
  engagement                  = NULL,
  content_reach               = NULL,
  content_reach_source        = NULL,
  content_engagement_source   = NULL,
  engagement_rate             = NULL,
  engagement_rate_followers   = NULL,
  is_post_day                 = false,
  restatement_log             = '2026-06-29 ER rebuild WEBDEV-295/296 (Airtable post backfill)'
WHERE f.platform    = 'instagram'
  AND f.data_status = 'settled'
  AND f.date NOT IN (
    DATE '2026-05-04', DATE '2026-05-05', DATE '2026-05-07', DATE '2026-05-08',
    DATE '2026-05-17', DATE '2026-05-19', DATE '2026-05-22', DATE '2026-05-24',
    DATE '2026-05-25', DATE '2026-05-26', DATE '2026-05-27', DATE '2026-05-28',
    DATE '2026-06-01', DATE '2026-06-02', DATE '2026-06-08', DATE '2026-06-09',
    DATE '2026-06-10', DATE '2026-06-11', DATE '2026-06-12', DATE '2026-06-19',
    DATE '2026-06-23'
  );

-- =============================================================================
-- END OF FILE
-- Dry-run SELECT is in SECTION 2 above and is SAFE to run.
-- UPDATE statements in SECTION 3 require controller sign-off + transaction wrap.
-- =============================================================================
