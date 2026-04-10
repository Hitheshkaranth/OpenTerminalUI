import { expect, test } from "@playwright/test";

test("notification center opens from the top bar", async ({ page, request }) => {
  await request.post("/api/notifications", {
    data: {
      type: "alert",
      title: "Alert: AAPL price_above",
      body: "AAPL crossed the configured threshold",
      ticker: "AAPL",
      action_url: "/equity/alerts",
      priority: "high",
    },
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  const bell = page.getByRole("button", { name: "Notifications" });
  await expect(bell).toBeVisible();
  await bell.click();

  const panel = page.getByTestId("notification-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "All" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Alerts" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "News" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "System" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Trades" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Mark all read" })).toBeVisible();
  await expect(panel.getByText("Alert: AAPL price_above")).toBeVisible();
  await expect(panel.getByText(/ago/i)).toBeVisible();

  await page.mouse.click(20, 20);
  await expect(panel).toBeHidden();
});
