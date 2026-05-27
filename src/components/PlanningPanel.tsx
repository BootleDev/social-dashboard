"use client";

import { useMemo } from "react";
import BestTimeToPost from "./BestTimeToPost";
import PinterestInsights from "./PinterestInsights";
import AudienceDemographics from "./AudienceDemographics";
import CompetitorInsights from "./CompetitorInsights";
import { num, sumField } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface PlanningPanelProps {
  posts: AirtableRecord[];
  instagramAudience: AirtableRecord[];
  pinterestTrends: AirtableRecord[];
  pinterestTopPins: AirtableRecord[];
  competitorRecords: AirtableRecord[];
  competitorLoading: boolean;
  competitorError: string;
  timezone: string;
}

/**
 * Content production workspace. Answers: "What should I make next? When?
 * For whom?" Brings together signals from current performance, trending
 * keywords, audience demographics, and competitor inspiration.
 *
 * Components are intentionally light on filters at this level — global Date
 * Range + Platform + Timezone (from the toolbar) apply throughout.
 */
export default function PlanningPanel({
  posts,
  instagramAudience,
  pinterestTrends,
  pinterestTopPins,
  competitorRecords,
  competitorLoading,
  competitorError,
  timezone,
}: PlanningPanelProps) {
  // Normalizers reused by Best Time to Post (matches Content Analysis).
  const normalizers = useMemo(() => {
    const maxVideoViews = posts.reduce(
      (max, p) => Math.max(max, num(p.fields["Video Views"])),
      0,
    );
    const maxImpressions = posts.reduce(
      (max, p) => Math.max(max, num(p.fields["Impressions"])),
      0,
    );
    const avgFollowers =
      posts.length > 0 ? sumField(posts, "Followers") / posts.length : 1;
    return { maxVideoViews, maxImpressions, avgFollowers };
  }, [posts]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="When to post"
        subtitle="Avg engagement by day-of-week × hour-of-day in your selected timezone. Click any cell for the contributing posts."
      />
      <BestTimeToPost
        posts={posts}
        timezone={timezone}
        normalizers={normalizers}
      />

      <SectionHeader
        title="What to make"
        subtitle="Pinterest trending keywords (search-side demand) and top-performing pins (Bootle-side conversion). Use trends + your historical best as creative anchors."
      />
      <PinterestInsights
        trends={pinterestTrends}
        topPins={pinterestTopPins}
        posts={posts}
        timezone={timezone}
      />

      <SectionHeader
        title="Who you reach"
        subtitle="Instagram follower demographics. Drives whether content choices map to actual audience interests."
      />
      <AudienceDemographics records={instagramAudience} />

      <SectionHeader
        title="Competitor signal"
        subtitle="Top-performing content from tracked drinkware brands. Inspiration and reference, not for copying."
      />
      <CompetitorInsights
        records={competitorRecords}
        loading={competitorLoading}
        error={competitorError}
      />
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle: string;
}

function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  return (
    <div className="mt-2">
      <h2
        className="text-base font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </h2>
      <p
        className="text-xs mt-1"
        style={{ color: "var(--text-secondary)" }}
      >
        {subtitle}
      </p>
    </div>
  );
}
