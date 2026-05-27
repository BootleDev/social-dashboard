"use client";

import { useMemo, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { alpha2ToNumeric } from "@/lib/countryCodes";

interface AudienceMapProps {
  /** Map of alpha-2 country code → audience count (followers in that country). */
  countryCounts: Record<string, number>;
  /** Total followers across all countries (denominator for share calc). */
  total: number;
  height?: number;
}

// Sequential blue palette anchored at our brand blue. Maps a 0..1 intensity
// to an rgba so countries with no data render transparent.
function intensityColor(intensity: number): string {
  if (intensity <= 0) return "rgba(168, 85, 247, 0.05)";
  const t = Math.max(0, Math.min(1, intensity));
  // Brand blue #0171E4 → rgba with alpha scaling from 0.15 to 0.95.
  return `rgba(1, 113, 228, ${0.15 + t * 0.8})`;
}

/**
 * World choropleth of audience by country. Source data is Instagram
 * follower demographics keyed by ISO alpha-2 country code; we look up the
 * numeric ISO code to join against the world-atlas TopoJSON in /public.
 *
 * Tooltip on hover shows country name + share + count. Click is reserved
 * for future filtering.
 */
export default function AudienceMap({
  countryCounts,
  total,
  height = 280,
}: AudienceMapProps) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  // Pre-compute the numeric-keyed map + the max value for color scaling.
  const numericCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [a2, count] of Object.entries(countryCounts)) {
      const num = alpha2ToNumeric(a2);
      if (num) out[num] = (out[num] ?? 0) + count;
    }
    return out;
  }, [countryCounts]);

  const max = useMemo(
    () => Math.max(0, ...Object.values(numericCounts)),
    [numericCounts],
  );

  if (max === 0) {
    return (
      <div
        className="rounded-xl flex items-center justify-center text-xs"
        style={{
          height,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
        }}
      >
        No country data for this snapshot.
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden relative"
      style={{
        height,
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <ComposableMap
        projectionConfig={{ scale: 130 }}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomableGroup center={[0, 20]} maxZoom={4} minZoom={0.9}>
          <Geographies geography="/world-110m.json">
            {({ geographies }: { geographies: Array<{
              rsmKey: string;
              id: string;
              properties: { name: string };
            }> }) =>
              geographies.map((geo) => {
                const count = numericCounts[geo.id] ?? 0;
                const intensity = max > 0 ? count / max : 0;
                const fill = intensityColor(intensity);
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={0.4}
                    style={{
                      default: { outline: "none" },
                      hover: {
                        fill:
                          count > 0
                            ? "rgba(1, 113, 228, 1)"
                            : "rgba(255,255,255,0.05)",
                        outline: "none",
                      },
                      pressed: { outline: "none" },
                    }}
                    onMouseMove={(evt: React.MouseEvent) => {
                      const pct =
                        total > 0
                          ? ((count / total) * 100).toFixed(1)
                          : "0.0";
                      setTooltip({
                        x: evt.clientX,
                        y: evt.clientY,
                        text: count
                          ? `${geo.properties.name}: ${count.toLocaleString()} (${pct}%)`
                          : `${geo.properties.name}: no audience`,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>
      {tooltip && (
        <div
          className="pointer-events-none fixed text-[11px] px-2 py-1 rounded z-50"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            background: "#1e2230",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
