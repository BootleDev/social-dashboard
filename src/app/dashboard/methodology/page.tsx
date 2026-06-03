"use client";

import Link from "next/link";
import MethodologyContent from "@/components/MethodologyContent";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * /dashboard/methodology — reader-facing explanation of how the dashboard's
 * account-level numbers are sourced (WEBDEV-146). Linked from the per-metric
 * KPI tooltips. Content lives in MethodologyContent; this page is chrome only.
 */
export default function MethodologyPage() {
  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3"
        style={{
          background: "var(--bg-primary)",
          borderBottom: "1px solid var(--border)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-xs px-2 py-1 rounded transition-colors hover:bg-white/10 cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
          >
            ← Dashboard
          </Link>
          <h1 className="text-lg font-bold">Methodology</h1>
        </div>
        <ThemeToggle />
      </header>

      <main className="p-6 max-w-[1400px] mx-auto">
        <p
          className="text-sm mb-5 max-w-3xl"
          style={{ color: "var(--text-secondary)" }}
        >
          How the Bootle Social Intelligence dashboard sources its numbers, and
          why some figures are shown for some platforms and not others.
        </p>
        <MethodologyContent />
      </main>
    </div>
  );
}
