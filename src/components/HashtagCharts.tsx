"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import { hashtagFrequency } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface HashtagChartsProps {
  posts: AirtableRecord[];
}

export default function HashtagCharts({ posts }: HashtagChartsProps) {
  const topHashtags = useMemo(
    () => hashtagFrequency(posts).slice(0, 10),
    [posts],
  );

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

  if (topHashtags.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard
        title="Top Hashtags by Frequency"
        tooltip="Most used hashtags across posts in this period"
      >
        <Bar
          data={hashtagData}
          options={{ ...defaultOptions, indexAxis: "y" as const }}
        />
      </ChartCard>
      <ChartCard
        title="Hashtag Avg ER %"
        tooltip="Average engagement rate for posts using each hashtag"
      >
        <Bar
          data={hashtagERData}
          options={{ ...defaultOptions, indexAxis: "y" as const }}
        />
      </ChartCard>
    </div>
  );
}
