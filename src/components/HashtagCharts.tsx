"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import { hashtagFrequency, str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

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
          backgroundColor: CHART_COLORS.blue + "60",
          borderColor: CHART_COLORS.blue,
          borderWidth: 1,
        },
      ],
    }),
    [topHashtags],
  );

  const hashtagERData = useMemo(
    () => ({
      labels: topHashtags.map((h) => h.tag),
      datasets: [
        {
          label: "Avg ER %",
          data: topHashtags.map((h) => h.avgER * 100),
          backgroundColor: CHART_COLORS.green + "60",
          borderColor: CHART_COLORS.green,
          borderWidth: 1,
        },
      ],
    }),
    [topHashtags],
  );

  const onBarClick = (
    _e: unknown,
    elements: Array<{ index: number }>,
    chart: { data: { labels?: unknown[] } },
  ) => {
    if (!onSelectHashtag || !elements.length) return;
    const tag = String(chart.data.labels?.[elements[0].index] ?? "");
    const subset = postsByTag.get(tag.toLowerCase()) ?? [];
    if (subset.length === 0) return;
    onSelectHashtag(tag, subset);
  };

  const clickableHorizontalOptions = {
    ...defaultOptions,
    indexAxis: "y" as const,
    onClick: onBarClick,
  };

  if (topHashtags.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard
        title="Top Hashtags by Frequency"
        tooltip="Most used hashtags across posts in this period. Click a bar to drill into the posts."
      >
        <Bar data={hashtagData} options={clickableHorizontalOptions} />
      </ChartCard>
      <ChartCard
        title="Hashtag Avg ER %"
        tooltip="Average engagement rate for posts using each hashtag. Click a bar to drill into the posts."
      >
        <Bar data={hashtagERData} options={clickableHorizontalOptions} />
      </ChartCard>
    </div>
  );
}
