"use client";

import { getPlatformConfig } from "@/lib/platforms";

interface Props {
  platforms: string[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

export default function PlatformFilter({
  platforms,
  selected,
  onChange,
}: Props) {
  function toggle(key: string) {
    const isActive = selected.has(key);
    if (isActive && selected.size <= 1) return; // prevent empty state
    const next = new Set(selected);
    if (isActive) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Platform filter">
      {platforms.map((key) => {
        const config = getPlatformConfig(key);
        const active = selected.has(key);
        return (
          <button
            key={key}
            onClick={() => toggle(key)}
            aria-pressed={active}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
            style={{
              background: active ? config.colorBg : "transparent",
              color: active ? config.color : "var(--text-secondary)",
              border: `1px solid ${active ? config.color : "var(--border)"}`,
              opacity: active ? 1 : 0.5,
            }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: config.color }}
            />
            {config.label}
          </button>
        );
      })}
    </div>
  );
}
