"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import ChartCard from "./ChartCard";
import StatsPanel from "./StatsPanel";
import { hashtagFrequency, hashtagsForERRanking, str } from "@/lib/utils";
import { describe } from "@/lib/stats";
import type { AirtableRecord } from "@/lib/utils";

/**
 * Minimum number of posts a hashtag must appear on before its AVERAGE
 * engagement rate is trustworthy enough to rank. Below this, the "average" is
 * one or two posts — noise, not a hashtag signal.
 */
const MIN_USES_FOR_ER = 3;

interface HashtagChartsProps {
  posts: AirtableRecord[];
  /** Called when a hashtag bar is clicked with the tag name (without #)
   *  and the subset of posts that used that hashtag. */
  onSelectHashtag?: (tag: string, subset: AirtableRecord[]) => void;
}

export default function HashtagCharts({
  posts,
  onSelectHashtag,
}: HashtagChartsProps) {
  const { colors, defaultOptions } = useChartTheme();

  const topHashtags = useMemo(
    () => hashtagFrequency(posts).slice(0, 10),
    [posts],
  );

  // Precompute posts-by-hashtag for fast click resolution.
  const postsByTag = useMemo(() => {
    const map = new Map<string, AirtableRecord[]>();
    for (const p of posts) {
      const hashtags = str(p.fields["Hashtags"]);
      if (!hashtags) continue;
      const tags = hashtags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);
      for (const tag of tags) {
        const arr = map.get(tag);
        if (arr) arr.push(p);
        else map.set(tag, [p]);
      }
    }
    return map;
  }, [posts]);

  const hashtagData = useMemo(
    () => ({
      labels: topHashtags.map((h) => h.tag),
      datasets: [
        {
          label: "Uses",
          data: topHashtags.map((h) => h.count),
          backgroundColor: colors.series[0] + "60",
          borderColor: colors.series[0],
          borderWidth: 1,
        },
      ],
    }),
    [topHashtags, colors],
  );

  // ER ranking is a SEPARATE list from the frequency chart: only hashtags used
  // at least MIN_USES_FOR_ER times are eligible, ranked by avg ER, top 10. The
  // label carries the sample size (n) so a reader sees how many posts back each
  // bar.
  const erRanked = useMemo(
    () => hashtagsForERRanking(posts, MIN_USES_FOR_ER).slice(0, 10),
    [posts],
  );

  const hashtagERData = useMemo(
    () => ({
      labels: erRanked.map((h) => `${h.tag} (n=${h.count})`),
      datasets: [
        {
          label: "Avg ER %",
          data: erRanked.map((h) => h.avgER * 100),
          backgroundColor: colors.series[1] + "60",
          borderColor: colors.series[1],
          borderWidth: 1,
        },
      ],
    }),
    [erRanked, colors],
  );

  // Resolve a clicked bar to its hashtag posts. `stripCount` removes the
  // " (n=…)" sample-size suffix the ER chart appends to its labels so the
  // lookup still matches postsByTag (keyed on the bare tag).
  const makeBarClick =
    (stripCount: boolean) =>
    (
      _e: unknown,
      elements: Array<{ index: number }>,
      chart: { data: { labels?: unknown[] } },
    ) => {
      if (!onSelectHashtag || !elements.length) return;
      let tag = String(chart.data.labels?.[elements[0].index] ?? "");
      if (stripCount) tag = tag.replace(/\s*\(n=\d+\)\s*$/, "");
      const subset = postsByTag.get(tag.toLowerCase()) ?? [];
      if (subset.length === 0) return;
      onSelectHashtag(tag, subset);
    };

  const frequencyOptions = {
    ...defaultOptions,
    indexAxis: "y" as const,
    onClick: makeBarClick(false),
  };

  const erOptions = {
    ...defaultOptions,
    indexAxis: "y" as const,
    onClick: makeBarClick(true),
  };

  // Stats for the ER distribution across eligible (n>=floor) hashtags only.
  const erStats = useMemo(
    () => describe(erRanked.map((h) => h.avgER * 100)),
    [erRanked],
  );
  const freqStats = useMemo(
    () => describe(topHashtags.map((h) => h.count)),
    [topHashtags],
  );

  if (topHashtags.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard
        title="Top Hashtags by Frequency"
        tooltip="Most used hashtags across posts in this period. Click a bar to drill into the posts."
        headerAction={
          <StatsPanel
            stats={freqStats}
            format={(v) => v.toFixed(0)}
            context="Frequency distribution across top hashtags"
          />
        }
      >
        <Bar data={hashtagData} options={frequencyOptions} />
      </ChartCard>
      <ChartCard
        title="Hashtag Avg ER %"
        tooltip={`Average engagement rate for posts using each hashtag, ranked high to low. Only hashtags used at least ${MIN_USES_FOR_ER} times are shown — below that the average is one or two posts and not a reliable signal. The (n=…) on each label is how many posts back the bar. Click a bar to drill into the posts.`}
        headerAction={
          erRanked.length > 0 ? (
            <StatsPanel
              stats={erStats}
              format={(v) => `${v.toFixed(2)}%`}
              context={`Avg ER distribution across hashtags used ≥${MIN_USES_FOR_ER} times`}
            />
          ) : undefined
        }
      >
        {erRanked.length > 0 ? (
          <Bar data={hashtagERData} options={erOptions} />
        ) : (
          <div
            className="flex items-center justify-center text-center text-sm h-full py-10"
            style={{ color: "var(--text-secondary)" }}
          >
            Not enough data yet — no hashtag has been used at least{" "}
            {MIN_USES_FOR_ER} times in this period, so average engagement rate
            per hashtag would not be reliable.
          </div>
        )}
      </ChartCard>
    </div>
  );
}
