import { test, expect } from "@playwright/test";

test("login page renders", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const legacyHeading = page.getByRole("heading", { name: /AUTHENTICATE/i });
  const simpleHeading = page.getByRole("heading", { name: /^Login$/i });
  await expect(legacyHeading.or(simpleHeading)).toBeVisible();

  const legacyUserInput = page.getByPlaceholder("Enter user ID...");
  const emailInput = page.getByPlaceholder("Email");
  await expect(legacyUserInput.or(emailInput)).toBeVisible();
});
