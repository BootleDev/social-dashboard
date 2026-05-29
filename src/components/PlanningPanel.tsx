"use client";

import BestTimeToPost from "./BestTimeToPost";
import PinterestInsights from "./PinterestInsights";
import CompetitorInsights from "./CompetitorInsights";
import UpcomingWindows from "./UpcomingWindows";
import SubNav, { useSubNav, type SubNavItem } from "./SubNav";
import type { AirtableRecord } from "@/lib/utils";

interface PlanningPanelProps {
  posts: AirtableRecord[];
  pinterestTrends: AirtableRecord[];
  seasonalOpportunities: AirtableRecord[];
  competitorRecords: AirtableRecord[];
  competitorLoading: boolean;
  competitorError: string;
  timezone: string;
}

type PlanningTab = "when" | "trends" | "seasonal" | "competitors";

const SUBNAV_ITEMS: ReadonlyArray<SubNavItem<PlanningTab>> = [
  { key: "when", label: "When to post" },
  { key: "trends", label: "Pinterest trends" },
  { key: "seasonal", label: "Seasonal windows" },
  { key: "competitors", label: "Competitor signal" },
];

const VALID_KEYS: ReadonlyArray<PlanningTab> = [
  "when",
  "trends",
  "seasonal",
  "competitors",
];

/**
 * Content production workspace. Answers: "What should I make next? When?"
 * Sub-tabs replace the long scroll the previous single-page layout produced
 * once we added trends, seasonal, and competitor sections.
 */
export default function PlanningPanel({
  posts,
  pinterestTrends,
  seasonalOpportunities,
  competitorRecords,
  competitorLoading,
  competitorError,
  timezone,
}: PlanningPanelProps) {
  const [subTab, setSubTab] = useSubNav<PlanningTab>(
    "planning",
    "when",
    VALID_KEYS,
  );

  return (
    <div className="space-y-4">
      <SubNav
        storageKey="planning"
        items={SUBNAV_ITEMS}
        value={subTab}
        onChange={setSubTab}
      />

      {subTab === "when" && (
        <Section
          title="When to post"
          subtitle="Day-of-week × hour-of-day heatmap in your selected timezone. The top-ranked slots panel above explicitly answers 'best time.' Click any cell for the contributing posts."
        >
          <BestTimeToPost
            posts={posts}
            timezone={timezone}
          />
        </Section>
      )}

      {subTab === "trends" && (
        <Section
          title="Pinterest trending keywords"
          subtitle="Search-side demand from Pinterest's Trends API. Default-filtered to Bootle-relevant terms (drinkware, wellness, seasonal gifting). Toggle to see all trends."
        >
          <PinterestInsights
            trends={pinterestTrends}
            seasonalOpportunities={seasonalOpportunities}
            posts={posts}
            timezone={timezone}
          />
        </Section>
      )}

      {subTab === "seasonal" && (
        <Section
          title="Upcoming seasonal windows"
          subtitle="Recurring annual moments approaching their lead-time window, with matching Pinterest trends."
        >
          <UpcomingWindows
            seasonalOpportunities={seasonalOpportunities}
            pinterestTrends={pinterestTrends}
          />
        </Section>
      )}

      {subTab === "competitors" && (
        <Section
          title="Competitor signal"
          subtitle="Top-performing content from tracked drinkware brands. Inspiration and reference, not for copying."
        >
          <CompetitorInsights
            records={competitorRecords}
            loading={competitorLoading}
            error={competitorError}
          />
        </Section>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

function Section({ title, subtitle, children }: SectionProps) {
  return (
    <div className="space-y-4">
      <div>
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
      {children}
    </div>
  );
}

