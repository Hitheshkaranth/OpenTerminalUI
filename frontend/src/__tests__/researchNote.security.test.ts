import { describe, expect, it } from "vitest";
import { toPrintHtml } from "../api/researchNote";

describe("research note print boundary", () => {
  it("renders raw HTML payloads as text instead of executable markup", () => {
    const doc = new DOMParser().parseFromString(toPrintHtml('# AAPL\n<img src=x onerror="alert(1)">\n<script>alert(1)</script>'), "text/html");
    expect(doc.querySelector("script, img, [onerror]")).toBeNull();
    expect(doc.body.textContent).toContain('<img src=x onerror="alert(1)">');
  });
  it.each(["javascript:alert", "data:text/html;base64,PHNjcmlwdD4=", "file:///etc/passwd", "javascript&#58;alert"])("rejects unsafe source URL %s", (url) => {
    const doc = new DOMParser().parseFromString(toPrintHtml(`[Source](${url})`), "text/html");
    expect(doc.querySelector("a")).toBeNull();
    expect(doc.body.textContent).toContain("Source");
  });
  it("keeps safe citation links and their query parameters intact", () => {
    const doc = new DOMParser().parseFromString(toPrintHtml("[Source](https://example.test/filing?a=1&amp;b=2)"), "text/html");
    expect(doc.querySelector("a")?.getAttribute("href")).toBe("https://example.test/filing?a=1&b=2");
  });
});
