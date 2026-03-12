"use client";

export default function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* KPI skeleton row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl p-4 h-[88px]"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
            }}
          >
            <div
              className="h-3 w-20 rounded mb-3"
              style={{ background: "var(--bg-secondary)" }}
            />
            <div
              className="h-6 w-16 rounded"
              style={{ background: "var(--bg-secondary)" }}
            />
          </div>
        ))}
      </div>

      {/* Chart skeleton row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl p-5"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
            }}
          >
            <div
              className="h-3 w-32 rounded mb-4"
              style={{ background: "var(--bg-secondary)" }}
            />
            <div
              className="h-[300px] rounded"
              style={{ background: "var(--bg-secondary)" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
