import { num, str, type AirtableRecord } from "./utils";

export interface Post {
  id: string;
  platform: string;
  postType: string;
  publishedAt: string;
  caption: string;
  mediaUrl: string;
  hashtags: string;

  // Raw metrics
  reach: number;
  impressions: number;
  engagementRate: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  videoViews: number;
  linkClicks: number;
  videoLengthSec: number;
  avgWatchTimeSec: number;

  // Content dimensions (committed — used for slicing)
  contentTheme: string;
  hookPresent: boolean;
  hookType: string;
  hookText: string;
  voType: string;
  ctaType: string;
  onScreenText: boolean;
  visualStyle: string;
  setting: string;
  contentPillar: string;
  talentPresent: boolean;

  // Draft dimensions (proposed by LLM, awaiting approval)
  draftHookType: string;
  draftVoType: string;
  draftCtaType: string;
  draftVisualStyle: string;
  draftSetting: string;
  draftContentPillar: string;

  taggingStatus: "Untagged" | "Draft" | "Approved" | "";
}

export function toPost(r: AirtableRecord): Post {
  return {
    id: r.id,
    platform: str(r.fields["Platform"]).toLowerCase().trim(),
    postType: str(r.fields["Post Type"]),
    publishedAt: str(r.fields["Published At"]),
    caption: str(r.fields["Caption"]),
    mediaUrl: str(r.fields["Media URL"]),
    hashtags: str(r.fields["Hashtags"]),

    reach: num(r.fields["Reach"]),
    impressions: num(r.fields["Impressions"]),
    engagementRate: num(r.fields["Engagement Rate"]),
    likes: num(r.fields["Likes"]),
    comments: num(r.fields["Comments"]),
    saves: num(r.fields["Saves"]),
    shares: num(r.fields["Shares"]),
    videoViews: num(r.fields["Video Views"]),
    linkClicks: num(r.fields["Link Clicks"]),
    videoLengthSec: num(r.fields["Video Length (s)"]),
    avgWatchTimeSec: num(r.fields["Avg Watch Time (s)"]),

    contentTheme: str(r.fields["Content Theme"]),
    hookPresent: Boolean(r.fields["Hook Present"]),
    hookType: str(r.fields["Hook Type"]),
    hookText: str(r.fields["Hook Text"]),
    voType: str(r.fields["VO Type"]),
    ctaType: str(r.fields["CTA Type"]),
    onScreenText: Boolean(r.fields["On-Screen Text"]),
    visualStyle: str(r.fields["Visual Style"]),
    setting: str(r.fields["Setting"]),
    contentPillar: str(r.fields["Content Pillar"]),
    talentPresent: Boolean(r.fields["Talent Present"]),

    draftHookType: str(r.fields["_Draft Hook Type"]),
    draftVoType: str(r.fields["_Draft VO Type"]),
    draftCtaType: str(r.fields["_Draft CTA Type"]),
    draftVisualStyle: str(r.fields["_Draft Visual Style"]),
    draftSetting: str(r.fields["_Draft Setting"]),
    draftContentPillar: str(r.fields["_Draft Content Pillar"]),

    taggingStatus: (str(r.fields["Tagging Status"]) as Post["taggingStatus"]) || "",
  };
}
