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

  await page.route("**/api/fno/chain/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/expiries")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.expiries) });
    } else if (url.includes("/summary")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.summary) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.chain) });
    }
  });

  await page.goto("/fno");
  const demoButton = page.getByRole("button", { name: />\s*DEMO ACCESS/i });
  if (await demoButton.isVisible().catch(() => false)) {
    await demoButton.click();
    await page.goto("/fno");
  }
  await expect(page.getByText("NSE F&O ANALYTICS")).toBeVisible();

  // Wait for the table to render
  await expect(page.getByText(/Strike/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("cell", { name: /22850/ }).first()).toBeVisible();
  await expect(page.getByText(/OI/i).first()).toBeVisible();
});
