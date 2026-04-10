import { expect, test } from "@playwright/test";

test("launchpad workspace templates can be applied, saved, and deleted", async ({ page }) => {
  await page.addInitScript(() => {
    const accessToken = localStorage.getItem("ot-access-token");
    const refreshToken = localStorage.getItem("ot-refresh-token");
    localStorage.clear();
    if (accessToken) localStorage.setItem("ot-access-token", accessToken);
    if (refreshToken) localStorage.setItem("ot-refresh-token", refreshToken);
  });

  await page.route("**/api/user/layouts", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        json: {
          items: [
            {
              id: "e2e-layout",
              name: "E2E Layout",
              panels: [],
            },
          ],
        },
      });
      return;
    }

    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/equity/launchpad", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Templates" }).click();
  await expect(page.getByTestId("workspace-template-gallery")).toBeVisible();
  await expect(page.locator('[data-template-origin="builtin"]')).toHaveCount(6);

  await page.getByTestId("workspace-template-apply-day-trading").click();
  await expect(page.getByTestId("launchpad-panel-frame")).toHaveCount(4);

  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByTestId("workspace-template-save-current").click();
  await page.getByTestId("workspace-template-name-input").fill("My Layout");
  await page.getByTestId("workspace-template-save-submit").click();

  const myLayoutCard = page.getByTestId(/workspace-template-card-custom-.+/).filter({ hasText: "My Layout" });
  await expect(myLayoutCard).toBeVisible();

  await myLayoutCard.getByRole("button", { name: "Delete" }).click();
  await expect(myLayoutCard).toHaveCount(0);
});
