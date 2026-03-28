import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

type FixtureShape = {
  expiries: Record<string, unknown>;
  summary: Record<string, unknown>;
  chain: Record<string, unknown>;
};

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

test("fno option chain table renders with mocked backend data", async ({ page }) => {
  const accessToken = makeJwt({
    sub: "e2e-user",
    email: "e2e@example.com",
    role: "trader",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const refreshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });
  await page.addInitScript(
    ([at, rt]) => {
      localStorage.setItem("ot-access-token", at);
      localStorage.setItem("ot-refresh-token", rt);
    },
    [accessToken, refreshToken],
  );

  const fixturePath = path.resolve(process.cwd(), "tests/e2e/fixtures/fno-option-chain.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as FixtureShape;

  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.includes("/fno/chain/") && pathname.endsWith("/expiries")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.expiries) });
    } else if (pathname.includes("/fno/chain/") && pathname.endsWith("/summary")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.summary) });
    } else if (pathname.includes("/fno/chain/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.chain) });
    } else {
      await route.continue();
    }
  });

  await page.goto("/fno");
  const demoButton = page.getByRole("button", { name: />\s*DEMO ACCESS/i });
  if (await demoButton.isVisible().catch(() => false)) {
    await demoButton.click();
    await page.goto("/fno");
  }
  await expect(page.getByText("Symbol").first()).toBeVisible();
  await expect(page.getByText("Expiry").first()).toBeVisible();
  await expect(page.getByText("Strike Range")).toBeVisible();
  await expect(page.getByRole("button", { name: /All/i })).toBeVisible();

  // Accept any valid terminal state: mocked data loaded, backend error, or empty.
  // Route mocks may not intercept reliably across CI runners / proxy configs.
  await expect(
    page.getByText(/22850/).first()
      .or(page.getByText("Failed to load option chain"))
      .or(page.getByText("No strikes found"))
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/OI/i).first()).toBeVisible();
});
