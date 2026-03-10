"use client";

import { str } from "@/lib/utils";
import type { Fields } from "@/lib/utils";

interface AlertsFeedProps {
  alerts: Array<{ fields: Fields }>;
}

const severityColors: Record<string, string> = {
  CRITICAL: "bg-red-500/20 text-red-400 border-red-500/30",
  HIGH: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  MEDIUM: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  LOW: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const typeIcons: Record<string, string> = {
  ER_DROP: "\u{1F4C9}",
  REACH_DECLINE: "\u{1F4C9}",
  VIRAL_POST: "\u{1F525}",
  FOLLOWER_SPIKE: "\u{1F4C8}",
  FOLLOWER_DROP: "\u{1F4C9}",
};

export default function AlertsFeed({ alerts }: AlertsFeedProps) {
  const recent = alerts.slice(0, 8);

  if (recent.length === 0) {
    return (
      <div
        className="rounded-xl p-5"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
      >
        <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
          Alerts
        </h3>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          No active alerts
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
        Alerts ({alerts.length})
      </h3>
      <div className="space-y-2 max-h-[340px] overflow-y-auto">
        {recent.map((alert, i) => {
          const type = str(alert.fields["Type"]);
          const severity = str(alert.fields["Severity"]);
          const platform = str(alert.fields["Platform"]);
          const message = str(alert.fields["Message"]);
          const date = str(alert.fields["Alert Date"]);
          const colorClass = severityColors[severity] || severityColors.LOW;
          const icon = typeIcons[type] || "\u26A0\uFE0F";

          return (
            <div key={i} className={`rounded-lg px-3 py-2 border text-xs ${colorClass}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">
                  {icon} {type}
                </span>
                <span className="opacity-70">{date?.split("T")[0]}</span>
              </div>
              <div className="opacity-90 capitalize">{platform}</div>
              <div className="opacity-70 mt-0.5">{message}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
