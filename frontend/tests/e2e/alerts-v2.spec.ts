import { expect, test } from "@playwright/test";

test("alerts builder creates and tests a multi-condition alert", async ({ page }) => {
  const context = page.context();
  const alerts: Array<Record<string, unknown>> = [];
  const history = { page: 1, page_size: 10, total: 0, history: [] as Array<Record<string, unknown>> };

  await context.route(/http:\/\/127\.0\.0\.1:\d+\/api\/alerts(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === "/api/alerts" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts }) });
      return;
    }

    if (pathname === "/api/alerts/history" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(history) });
      return;
    }

    if (pathname === "/api/alerts" && request.method() === "POST") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      const created = {
        id: "alert-1",
        status: "active",
        ticker: "RELIANCE",
        alert_type: "price",
        condition: "above",
        threshold: 2500,
        note: "",
        created_at: new Date().toISOString(),
        trigger_count: 0,
        ...payload,
        channels: payload.delivery_channels || ["in_app"],
      };
      alerts.unshift(created);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "created", alert: created }) });
      return;
    }

    if (pathname === "/api/alerts/alert-1/test" && request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "sent", id: "alert-1", channels: ["in_app", "webhook"] }),
      });
      return;
    }

    if (pathname === "/api/alerts/alert-1" && request.method() === "PATCH") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      alerts[0] = { ...alerts[0], ...payload };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "updated", id: "alert-1", alert: alerts[0] }),
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/equity/alerts", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Create New Alert" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.getByLabel("Symbol").fill("RELIANCE");
  await page.getByLabel("Condition value 1").fill("2500");
  await page.getByRole("button", { name: "Add Condition" }).click();
  await page.getByLabel("Condition field 2").selectOption("rsi_14");
  await page.getByLabel("Condition operator 2").selectOption("above");
  await page.getByLabel("Condition value 2").fill("70");
  await page.getByRole("button", { name: "AND" }).click();
  await page.getByRole("checkbox", { name: "Webhook" }).check();
  await page.getByLabel("Webhook URL").fill("https://example.com/hook");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("RELIANCE")).toBeVisible();
  await expect(page.getByText(/price above 2500 AND rsi_14 above 70/i)).toBeVisible();

  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.getByText("Test notification sent")).toBeVisible();
});
