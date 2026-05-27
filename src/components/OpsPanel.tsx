"use client";

import { useState } from "react";
import PlatformCompare from "./PlatformCompare";
import TaggingPage from "@/app/dashboard/tagging/page";
import type { AirtableRecord } from "@/lib/utils";

interface OpsPanelProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
}

type Sub = "tagging" | "platforms" | "health";

/**
 * Admin / ops workspace. Tagging UI for human content classification, cross-
 * platform comparison (technical view), and pipeline health.
 */
export default function OpsPanel({ posts, dailyMetrics }: OpsPanelProps) {
  const [sub, setSub] = useState<Sub>("tagging");

  const subs: { key: Sub; label: string; description: string }[] = [
    { key: "tagging", label: "Tagging", description: "Manually tag posts that AI hasn't caught" },
    { key: "platforms", label: "Platform Compare", description: "Cross-platform reach trends — technical view" },
    { key: "health", label: "Pipeline Health", description: "Data feed status + freshness" },
  ];

  return (
    <div className="space-y-4">
      <nav
        className="flex gap-2 rounded-lg p-1 w-fit"
        style={{ background: "var(--bg-secondary)" }}
      >
        {subs.map((s) => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            className="px-3 py-1.5 rounded text-xs font-medium transition-all cursor-pointer"
            style={{
              background:
                sub === s.key ? "var(--accent-purple)" : "transparent",
              color: sub === s.key ? "#fff" : "var(--text-secondary)",
            }}
            title={s.description}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {sub === "tagging" && <TaggingPage />}
      {sub === "platforms" && (
        <PlatformCompare posts={posts} dailyMetrics={dailyMetrics} />
      )}
      {sub === "health" && <PipelineHealth />}
    </div>
  );
}

/**
 * Lightweight pipeline-health view. Lists the data feeds and (a) their last-
 * update date inferred from the most recent record (b) whether each feed
 * looks healthy.
 *
 * Future work: tie into Social Alerts table heartbeats for active monitoring.
 */
function PipelineHealth() {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <h3
        className="text-sm font-medium mb-3"
        style={{ color: "var(--text-secondary)" }}
      >
        Pipeline Health
      </h3>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Data feeds run daily via n8n. Heartbeat alerts land in Social Alerts.
        Detailed health view is planned — for now, the Last data date in the
        header is the canonical freshness indicator.
      </p>
    </div>
  );
}
