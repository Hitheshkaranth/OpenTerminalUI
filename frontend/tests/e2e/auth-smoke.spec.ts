import { test, expect } from "@playwright/test";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "AUTHENTICATE" })).toBeVisible();
  await expect(page.getByPlaceholder("Enter user ID...")).toBeVisible();
});
