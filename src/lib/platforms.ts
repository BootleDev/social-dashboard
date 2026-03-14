export interface PlatformConfig {
  key: string;
  label: string;
  color: string;
  colorBg: string;
  colorFill: string;
}

const PLATFORM_REGISTRY: Record<string, PlatformConfig> = {
  instagram: {
    key: "instagram",
    label: "Instagram",
    color: "#a855f7",
    colorBg: "rgba(168, 85, 247, 0.15)",
    colorFill: "rgba(168, 85, 247, 0.1)",
  },
  facebook: {
    key: "facebook",
    label: "Facebook",
    color: "#3b82f6",
    colorBg: "rgba(59, 130, 246, 0.15)",
    colorFill: "rgba(59, 130, 246, 0.1)",
  },
  pinterest: {
    key: "pinterest",
    label: "Pinterest",
    color: "#e60023",
    colorBg: "rgba(230, 0, 35, 0.15)",
    colorFill: "rgba(230, 0, 35, 0.1)",
  },
  tiktok: {
    key: "tiktok",
    label: "TikTok",
    color: "#00f2ea",
    colorBg: "rgba(0, 242, 234, 0.15)",
    colorFill: "rgba(0, 242, 234, 0.1)",
  },
  youtube: {
    key: "youtube",
    label: "YouTube",
    color: "#ff4500",
    colorBg: "rgba(255, 69, 0, 0.15)",
    colorFill: "rgba(255, 69, 0, 0.1)",
  },
};

const FALLBACK_COLORS = [
  "#f59e0b",
  "#ec4899",
  "#22c55e",
  "#06b6d4",
  "#ef4444",
];

export function getPlatformConfig(key: string): PlatformConfig {
  const normalized = key.toLowerCase().trim();
  const registered = PLATFORM_REGISTRY[normalized];
  if (registered) return registered;

  const hash = Array.from(normalized).reduce(
    (acc, c) => acc + c.charCodeAt(0),
    0,
  );
  const fallbackColor = FALLBACK_COLORS[hash % FALLBACK_COLORS.length];

  return {
    key: normalized,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    color: fallbackColor,
    colorBg: `${fallbackColor}26`,
    colorFill: `${fallbackColor}1a`,
  };
}

/** Canonical sort order for known platforms, unknown platforms sort after. */
const SORT_ORDER: Record<string, number> = {
  instagram: 0,
  facebook: 1,
  pinterest: 2,
  tiktok: 3,
  youtube: 4,
};

export function platformSortOrder(key: string): number {
  return SORT_ORDER[key.toLowerCase()] ?? 99;
}
