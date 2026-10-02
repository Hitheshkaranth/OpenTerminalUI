import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The shared `api` client's baseURL is already "/api". A path like api.get("/api/x") becomes
// /api/api/x and 404s; mocked unit tests can't see that, so scan the source instead.
// (The filings swarm shipped this bug in three clients at once.)
describe("api client paths", () => {
  it("never prefix /api on the shared client", () => {
    const dir = join(__dirname, "..", "api");
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      if (!/from "\.\/base"|from "\.\/client"/.test(src)) continue;
      const bad = src.match(/\bapi\.(get|post|put|patch|delete)(<[^>]*>)?\(\s*[`"']\/api\//g);
      const badConst = src.match(/const\s+\w+\s*=\s*["'`]\/api\/[a-z]/gi);
      if (bad || badConst) offenders.push(`${file}: ${[...(bad ?? []), ...(badConst ?? [])].join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
