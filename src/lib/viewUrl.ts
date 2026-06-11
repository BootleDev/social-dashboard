// Resolve the "View" link on a post to the actual post/pin, not its
// click-through destination.
//
// For Instagram/Facebook, the Posts "Media URL" is already the permalink
// (instagram.com/reel/…, facebook.com/reel/…), so we use it as-is.
//
// For Pinterest, "Media URL" is the product page the pin links OUT to, not the
// pin itself. The real pin lives in "Post ID" as `pinterest_<numericId>`, so we
// rebuild the canonical pin permalink from that id. If the id isn't the shape we
// expect, we fall back to the media URL rather than emitting a broken link.
export function resolveViewUrl(
  platform: string,
  postId: string,
  mediaUrl: string,
): string {
  if (platform === "pinterest") {
    const numericId = postId.replace(/^pinterest_/, "").trim();
    if (numericId && /^\d+$/.test(numericId)) {
      return `https://www.pinterest.com/pin/${numericId}/`;
    }
    // Unknown id shape — fall back to whatever URL we have rather than 404.
  }
  return mediaUrl;
}
