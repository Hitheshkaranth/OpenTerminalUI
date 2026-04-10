import { expect, test } from "@playwright/test";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("custom formula screener validates, runs, and saves formulas", async ({ page }) => {
  const token = fakeJwt({
    sub: "u_e2e",
    email: "trader@example.com",
    role: "trader",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  await page.addInitScript((jwt) => {
    localStorage.setItem("ot-access-token", jwt);
    localStorage.setItem("ot-refresh-token", "dummy");
  }, token);

  let saved = [
    {
      id: 1,
      name: "Existing",
      formula: "roe + revenue_growth",
      description: "Preloaded",
      created_at: new Date().toISOString(),
    },
  ];

  await page.route("**/api/**/screener/presets*", async (route) => {
    await route.fulfill({ status: 200, json: { items: [] } });
  });
  await page.route("**/api/**/screener/screens*", async (route) => {
    await route.fulfill({ status: 200, json: { items: [] } });
  });
  await page.route("**/api/**/screener/public*", async (route) => {
    await route.fulfill({ status: 200, json: { items: [] } });
  });
  await page.route("**/api/**/screener/saved-formulas*", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({ status: 200, json: saved });
      return;
    }
    if (method === "POST") {
      const body = route.request().postDataJSON() as { name: string; formula: string; description?: string };
      const item = {
        id: saved.length + 1,
        name: body.name,
        formula: body.formula,
        description: body.description || "",
        created_at: new Date().toISOString(),
      };
      saved = [item, ...saved];
      await route.fulfill({ status: 200, json: item });
      return;
    }
    await route.fulfill({ status: 200, json: { status: "deleted" } });
  });
  await page.route("**/api/**/screener/custom-formula", async (route) => {
    const body = route.request().postDataJSON() as { formula: string };
    if (body.formula.includes("import")) {
      await route.fulfill({ status: 400, json: { detail: "Unsafe token in formula" } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        formula: body.formula,
        count: 2,
        results: [
          {
            symbol: "RELIANCE",
            name: "Reliance Industries",
            sector: "Energy",
            computed_value: 45.2,
            pe: 24.5,
            pb: 1.85,
            roe: 12.6,
            market_cap: 1990000,
          },
          {
            symbol: "INFY",
            name: "Infosys",
            sector: "Technology",
            computed_value: 38.1,
            pe: 22.4,
            pb: 1.7,
            roe: 15.1,
            market_cap: 780000,
          },
        ],
      },
    });
  });

  await page.goto("/equity/screener", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Custom Formula" }).click();
  await expect(page.getByText("Validation OK")).toBeVisible();

  const formulaEditor = page.locator("textarea").first();
  await formulaEditor.fill("pe * pb");
  await expect(page.getByText("Validation OK")).toBeVisible();

  await page.getByRole("button", { name: /^Run$/ }).click();
  await expect(page.getByText("Computed Value (pe * pb)")).toBeVisible();
  await expect(page.getByText("RELIANCE")).toBeVisible();

  await formulaEditor.fill("import os");
  await expect(page.getByText("Unsafe token in formula")).toBeVisible();

  await formulaEditor.fill("pe * pb");
  await page.getByRole("button", { name: "Save Formula" }).click();
  await page.getByPlaceholder("Formula name").fill("PB x PE");
  await page.getByPlaceholder("Description").last().fill("Saved from e2e");
  await page.locator('[role="dialog"]').getByRole("button", { name: "Save" }).click();

  await page.getByRole("combobox").nth(2).selectOption({ label: "PB x PE" });
  await expect(page.getByText("PB x PE")).toBeVisible();
});
