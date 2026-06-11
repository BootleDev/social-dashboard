import { describe, it, expect } from "vitest";
import { resolveViewUrl } from "../viewUrl";

describe("resolveViewUrl", () => {
  it("rebuilds the Pinterest pin permalink from the prefixed Post ID", () => {
    expect(
      resolveViewUrl(
        "pinterest",
        "pinterest_1097893215432954059",
        "https://bootle.io/store/bootles/steel-bootle?utm_source=pinterest",
      ),
    ).toBe("https://www.pinterest.com/pin/1097893215432954059/");
  });

  it("falls back to the media URL when the Pinterest id isn't numeric", () => {
    const media = "https://bootle.io/store/bootles/steel-bootle";
    expect(resolveViewUrl("pinterest", "pinterest_", media)).toBe(media);
    expect(resolveViewUrl("pinterest", "", media)).toBe(media);
    expect(resolveViewUrl("pinterest", "weird-id", media)).toBe(media);
  });

  it("uses the Instagram permalink as-is", () => {
    const url = "https://www.instagram.com/reel/DZWkfsgNCkk/";
    expect(resolveViewUrl("instagram", "18064604015706345", url)).toBe(url);
  });

  it("uses the Facebook permalink as-is", () => {
    const url = "https://www.facebook.com/reel/1535533168062404/";
    expect(
      resolveViewUrl("facebook", "107021072070181_979628398152864", url),
    ).toBe(url);
  });

  it("returns an empty string when there's no url and platform isn't Pinterest", () => {
    expect(resolveViewUrl("instagram", "123", "")).toBe("");
  });
});
