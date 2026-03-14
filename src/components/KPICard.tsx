"use client";

import { getPlatformConfig } from "@/lib/platforms";

interface KPICardProps {
  title: string;
  value: string;
  change?: number;
  subtitle?: string;
  tooltip?: string;
  invertChange?: boolean;
  platformLabel?: string;
}

export default function KPICard({
  title,
  value,
  change,
  subtitle,
  tooltip,
  invertChange,
  platformLabel,
}: KPICardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const isGood = invertChange ? isNegative : isPositive;
  const isBad = invertChange ? isPositive : isNegative;
  const changeColor = isGood ? "text-green-400" : isBad ? "text-red-400" : "";
  const arrow = isPositive ? "\u2191" : isNegative ? "\u2193" : "";

  const platformConfig = platformLabel
    ? getPlatformConfig(platformLabel)
    : null;

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <span
        className="text-xs font-medium flex items-center gap-1"
        style={{ color: "var(--text-secondary)" }}
      >
        {title}
        {platformConfig && (
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
            style={{
              background: platformConfig.colorBg,
              color: platformConfig.color,
            }}
          >
            {platformConfig.label}
          </span>
        )}
        {tooltip && (
          <span
            title={tooltip}
            aria-label={tooltip}
            role="img"
            className="cursor-help opacity-50 hover:opacity-100"
          >
            i
          </span>
        )}
      </span>
      <span className="text-2xl font-bold">{value}</span>
      <div className="flex items-center gap-2">
        {change !== undefined ? (
          <span className={`text-xs font-medium ${changeColor}`}>
            {arrow} {Math.abs(change).toFixed(1)}%
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            no prior data
          </span>
        )}
        {subtitle && (
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
