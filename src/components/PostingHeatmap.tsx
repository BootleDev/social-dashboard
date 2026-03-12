"use client";

import { Fragment, useMemo } from "react";
import { postingHeatmap } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface PostingHeatmapProps {
  posts: AirtableRecord[];
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PostingHeatmap({ posts }: PostingHeatmapProps) {
  const heatmapData = useMemo(() => postingHeatmap(posts), [posts]);

  const maxER = useMemo(
    () => Math.max(...heatmapData.map((h) => h.avgER), 0.001),
    [heatmapData],
  );

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <h3
        className="text-sm font-medium mb-4"
        style={{ color: "var(--text-secondary)" }}
      >
        Best Posting Times (Avg ER by Day/Hour)
      </h3>
      <div className="overflow-x-auto">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: "40px repeat(24, 1fr)" }}
        >
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="text-[8px] text-center"
              style={{ color: "var(--text-secondary)" }}
            >
              {h}
            </div>
          ))}
          {dayNames.map((day, dayIdx) => (
            <Fragment key={dayIdx}>
              <div
                className="text-[10px] flex items-center"
                style={{ color: "var(--text-secondary)" }}
              >
                {day}
              </div>
              {Array.from({ length: 24 }, (_, h) => {
                const cell = heatmapData.find(
                  (c) => c.day === dayIdx && c.hour === h,
                );
                const intensity = cell ? cell.avgER / maxER : 0;
                return (
                  <div
                    key={`${dayIdx}-${h}`}
                    className="aspect-square rounded-sm"
                    style={{
                      background: cell
                        ? `rgba(168, 85, 247, ${0.1 + intensity * 0.8})`
                        : "var(--bg-secondary)",
                    }}
                    title={
                      cell
                        ? `${day} ${h}:00 — ER: ${(cell.avgER * 100).toFixed(2)}% (${cell.count} posts)`
                        : `${day} ${h}:00 — no data`
                    }
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
