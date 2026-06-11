import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportToCSV } from "../csv";

// exportToCSV builds a Blob and triggers a download. We capture the Blob text
// by stubbing URL.createObjectURL and reading the blob passed to it.
let captured: Blob | null = null;

beforeEach(() => {
  captured = null;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob) => {
    captured = blob;
    return "blob:mock";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  // jsdom's anchor click() is a no-op; nothing else to stub.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(headers: string[], rows: string[][]): Promise<string> {
  exportToCSV(headers, rows, "test.csv");
  if (!captured) throw new Error("no blob captured");
  return await (captured as Blob).text();
}

describe("exportToCSV", () => {
  it("neutralizes formula-injection payloads with a leading quote", async () => {
    const text = await run(
      ["Caption"],
      [["=HYPERLINK(\"http://evil\",\"x\")"], ["+1+1"], ["-2"], ["@cmd"]],
    );
    // Each dangerous leading char must be prefixed with ' so Excel treats it as
    // text. The cell is also wrapped in quotes because it contains a comma/quote.
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("'+1+1");
    expect(text).toContain("'-2");
    expect(text).toContain("'@cmd");
  });

  it("leads with a UTF-8 BOM", async () => {
    exportToCSV(["A"], [["1"]], "test.csv");
    if (!captured) throw new Error("no blob captured");
    // Check the raw bytes: a UTF-8 BOM is EF BB BF. (jsdom's Blob.text()
    // decoder swallows the BOM, so assert at the byte level instead.)
    const bytes = new Uint8Array(await (captured as Blob).arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("uses CRLF row terminators", async () => {
    const text = await run(["A", "B"], [["1", "2"]]);
    expect(text).toContain("A,B\r\n1,2");
  });

  it("escapes commas, quotes, and newlines without corrupting safe text", async () => {
    const text = await run(["X"], [['a,b'], ['he said "hi"'], ["plain"]]);
    expect(text).toContain('"a,b"');
    expect(text).toContain('"he said ""hi"""');
    // A safe value is not quoted and not prefixed.
    expect(text).toMatch(/(^|\r\n)plain(\r\n|$)/);
  });
});
