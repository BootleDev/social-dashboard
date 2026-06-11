/** Create a CSV file and trigger browser download. */
export function exportToCSV(
  headers: string[],
  rows: string[][],
  filename: string,
): void {
  const escape = (val: string): string => {
    let v = val;
    // Formula-injection guard: a leading = + - @ (or tab/CR) makes Excel/Sheets
    // execute the cell as a formula. Captions — including scraped competitor
    // captions, which are untrusted third-party text — flow straight into the
    // export, so prefix any such value with a single quote to force it to text.
    if (/^[=+\-@\t\r]/.test(v)) {
      v = `'${v}`;
    }
    if (v.includes(",") || v.includes('"') || v.includes("\n") || v.includes("\r")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  // RFC 4180 record terminator is CRLF; some Excel importers mis-handle bare \n.
  const csvContent = [
    headers.map(escape).join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ].join("\r\n");

  // Lead with a UTF-8 BOM so Excel on Windows decodes emoji/accents correctly
  // instead of falling back to the system ANSI codepage (mojibake).
  const blob = new Blob(["\uFEFF" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
