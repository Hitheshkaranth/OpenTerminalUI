import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

async function loginAndOpen(page: import("@playwright/test").Page, targetPath: string) {
  const accessToken = makeJwt({
    sub: "position-sizer-e2e-user",
    email: "position.sizer@example.com",
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

  await page.goto(targetPath, { waitUntil: "domcontentloaded" });
  await page.getByText(/(?:Restoring|Loading) workspace/i).waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  await expect(page.getByPlaceholder(/Type ticker, command, or search/i)).toBeVisible({ timeout: 15_000 });
}

test("position sizer calculates fixed fractional and Kelly sizing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop calculator validation");

  await loginAndOpen(page, "/equity/position-sizer");

  await expect(page.getByText("Position Sizer")).toBeVisible();

  await page.getByLabel("Account Size").fill("1000000");
  await page.getByLabel("Risk Percentage").fill("1");
  await page.getByLabel("Entry Price").fill("2500");
  await page.getByLabel("Stop Loss Price").fill("2450");

  await expect(page.getByTestId("position-sizer-shares")).toContainText("200");
  await expect(page.getByTestId("position-sizer-position-value")).toContainText("500,000");
  await expect(page.getByTestId("position-sizer-max-risk")).toContainText("10,000");

  await page.getByLabel("Target Price").fill("2600");
  await expect(page.getByTestId("position-sizer-rr")).toContainText("1 : 2.00");

  await page.getByRole("button", { name: /Kelly Criterion/i }).click();
  await page.getByLabel("Win Rate Percentage").fill("60");
  await page.getByLabel("Average Win").fill("100");
  await page.getByLabel("Average Loss").fill("50");

  await expect(page.getByTestId("position-sizer-kelly-full")).toContainText("40.00%");

  await page.getByRole("button", { name: /Fixed Fractional/i }).click();
  await page.getByLabel("Stop Loss Price").fill("2500");
  await expect(page.getByText("Stop loss must differ from entry.")).toBeVisible();
});
