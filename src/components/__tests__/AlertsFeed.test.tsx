import "@testing-library/jest-dom";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AlertsFeed from "../AlertsFeed";
import type { AirtableRecord } from "@/lib/utils";

afterEach(cleanup);

function alert(
  id: string,
  fields: Record<string, unknown>,
): AirtableRecord {
  return { id, fields, createdTime: "2026-05-31T00:00:00.000Z" };
}

function post(postId: string, extra: Record<string, unknown> = {}): AirtableRecord {
  return {
    id: `rec_${postId}`,
    fields: { "Post ID": postId, Platform: "facebook", Caption: "hi", ...extra },
    createdTime: "2026-04-06T00:00:00.000Z",
  };
}

const viralFb = alert("a1", {
  Type: "VIRAL_POST",
  Severity: "LOW",
  Platform: "facebook",
  Message: "Viral post detected: reach 299 (9.9x avg)",
  "Alert Date": "2026-05-30",
  "Post ID": "107021072070181_928344896614548",
});

describe("AlertsFeed", () => {
  it("renders a post-referencing alert when its post is present, as a clickable button", () => {
    const onSelectPost = vi.fn();
    const matchingPost = post("107021072070181_928344896614548");

    render(
      <AlertsFeed
        alerts={[viralFb]}
        posts={[matchingPost]}
        onSelectPost={onSelectPost}
      />,
    );

    const trigger = screen.getByRole("button", { name: /viral_post/i });
    fireEvent.click(trigger);
    expect(onSelectPost).toHaveBeenCalledTimes(1);
    expect(onSelectPost).toHaveBeenCalledWith(matchingPost);
  });

  it("HIDES a post-referencing alert when no matching post is in range", () => {
    const onSelectPost = vi.fn();
    // posts list does NOT contain the alert's Post ID (e.g. out of date range)
    render(
      <AlertsFeed
        alerts={[viralFb]}
        posts={[post("some_other_id")]}
        onSelectPost={onSelectPost}
      />,
    );

    expect(screen.queryByText(/VIRAL_POST/)).not.toBeInTheDocument();
    expect(screen.getByText(/no active alerts/i)).toBeInTheDocument();
  });

  it("always shows a non-post alert (no Post ID) and does not make it clickable", () => {
    const onSelectPost = vi.fn();
    const followerSpike = alert("a2", {
      Type: "FOLLOWER_SPIKE",
      Severity: "LOW",
      Platform: "instagram",
      Message: "Followers up 12%",
      "Alert Date": "2026-05-30",
      // no Post ID
    });

    render(
      <AlertsFeed
        alerts={[followerSpike]}
        posts={[]}
        onSelectPost={onSelectPost}
      />,
    );

    expect(screen.getByText(/FOLLOWER_SPIKE/)).toBeInTheDocument();
    // Not rendered as a button (no post to open).
    expect(
      screen.queryByRole("button", { name: /follower_spike/i }),
    ).not.toBeInTheDocument();
  });

  it("deduplicates daily-repeated alerts to one entry per distinct alert", () => {
    const onSelectPost = vi.fn();
    // Same viral post logged on 3 consecutive days -> 3 records, 1 distinct alert.
    const day = (d: string, reach: number) =>
      alert(`v_${d}`, {
        Type: "VIRAL_POST",
        Severity: "LOW",
        Platform: "facebook",
        Message: `Viral post detected: reach ${reach}`,
        "Alert Date": d,
        "Post ID": "107021072070181_928344896614548",
      });

    render(
      <AlertsFeed
        alerts={[
          day("2026-05-30", 299),
          day("2026-05-29", 299),
          day("2026-05-28", 305),
        ]}
        posts={[post("107021072070181_928344896614548")]}
        onSelectPost={onSelectPost}
      />,
    );

    // Header counts 1 distinct alert, not 3.
    expect(screen.getByText("Alerts (1)")).toBeInTheDocument();
    // Only one clickable card rendered.
    expect(
      screen.getAllByRole("button", { name: /viral_post/i }),
    ).toHaveLength(1);
  });

  it("keeps the most recent occurrence when deduplicating", () => {
    const onSelectPost = vi.fn();
    render(
      <AlertsFeed
        alerts={[
          alert("new", {
            Type: "ER_DROP",
            Severity: "MEDIUM",
            Platform: "pinterest",
            Message: "Pinterest ER dropped 80% vs prev week",
            "Alert Date": "2026-05-31",
          }),
          alert("old", {
            Type: "ER_DROP",
            Severity: "MEDIUM",
            Platform: "pinterest",
            Message: "Pinterest ER dropped 80% vs prev week",
            "Alert Date": "2026-05-29",
          }),
        ]}
        posts={[]}
        onSelectPost={onSelectPost}
      />,
    );

    expect(screen.getByText("Alerts (1)")).toBeInTheDocument();
    // The surviving card shows the most recent date.
    expect(screen.getByText("2026-05-31")).toBeInTheDocument();
    expect(screen.queryByText("2026-05-29")).not.toBeInTheDocument();
  });

  it("treats different posts of the same alert type as distinct", () => {
    const onSelectPost = vi.fn();
    render(
      <AlertsFeed
        alerts={[
          alert("fb", {
            Type: "VIRAL_POST",
            Severity: "LOW",
            Platform: "facebook",
            Message: "Viral",
            "Alert Date": "2026-05-30",
            "Post ID": "fb_post",
          }),
          alert("ig", {
            Type: "VIRAL_POST",
            Severity: "LOW",
            Platform: "instagram",
            Message: "Viral",
            "Alert Date": "2026-05-30",
            "Post ID": "ig_post",
          }),
        ]}
        posts={[
          post("fb_post", { Platform: "facebook" }),
          post("ig_post", { Platform: "instagram" }),
        ]}
        onSelectPost={onSelectPost}
      />,
    );

    expect(screen.getByText("Alerts (2)")).toBeInTheDocument();
  });

  it("shows all distinct alerts in the period without capping the list", () => {
    const onSelectPost = vi.fn();
    // 10 distinct account-level alerts -> all 10 shown, header reads plain count.
    const many = Array.from({ length: 10 }, (_, n) =>
      alert(`m${n}`, {
        Type: "REACH_DECLINE",
        Severity: "MEDIUM",
        Platform: "instagram",
        Message: `decline #${n}`,
        "Alert Date": "2026-05-30",
      }),
    );

    render(
      <AlertsFeed alerts={many} posts={[]} onSelectPost={onSelectPost} />,
    );

    expect(screen.getByText("Alerts (10)")).toBeInTheDocument();
    expect(screen.getByText("decline #9")).toBeInTheDocument();
  });

  it("counts only visible alerts in the header (hidden out-of-range alerts excluded)", () => {
    const onSelectPost = vi.fn();
    const keep = alert("a3", {
      Type: "FOLLOWER_SPIKE",
      Severity: "LOW",
      Platform: "instagram",
      Message: "Followers up 12%",
      "Alert Date": "2026-05-30",
    });

    render(
      <AlertsFeed
        alerts={[viralFb, keep]}
        posts={[]} // viralFb's post is absent -> hidden
        onSelectPost={onSelectPost}
      />,
    );

    // Only the follower-spike alert remains visible.
    expect(screen.getByText("Alerts (1)")).toBeInTheDocument();
  });
});
