import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

test("model lab e2e: create -> run -> report -> compare", async ({ page }) => {
  const accessToken = makeJwt({
    sub: "e2e-user",
    email: "e2e@example.com",
    role: "trader",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const refreshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });

  const experiments = [
    {
      id: "exp_1",
      name: "Alpha",
      description: "Baseline",
      tags: ["daily"],
      model_key: "sma_crossover",
      benchmark_symbol: "NIFTY50",
      start_date: "2025-01-01",
      end_date: "2025-12-31",
      created_at: "2026-02-19T00:00:00",
    },
  ];
  let runStatusCalls = 0;

  await page.route("**/api/model-lab/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // List experiments: GET .../model-lab/experiments (no ID)
    if (url.match(/\/model-lab\/experiments\/?(\?.*)?$/) && method === "GET") {
      await route.fulfill({ json: { items: experiments } });
      return;
    }

    // Create experiment: POST .../model-lab/experiments
    if (url.match(/\/model-lab\/experiments\/?$/) && method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const created = {
        id: `exp_${experiments.length + 1}`,
        name: String(body.name || "New"),
        description: String(body.description || ""),
        tags: Array.isArray(body.tags) ? body.tags : [],
        model_key: String(body.model_key || "sma_crossover"),
        benchmark_symbol: String(body.benchmark_symbol || "NIFTY50"),
        start_date: String(body.start_date || "2025-01-01"),
        end_date: String(body.end_date || "2025-12-31"),
        created_at: new Date().toISOString(),
      };
      experiments.unshift(created);
      await route.fulfill({ json: created });
      return;
    }

    // Detail: GET .../model-lab/experiments/{id}
    if (url.match(/\/model-lab\/experiments\/[^/?]+(\?.*)?$/) && method === "GET") {
      const expId = url.split("/model-lab/experiments/")[1].split("?")[0];
      const exp = experiments.find((x) => x.id === expId) || experiments[0];
      await route.fulfill({
        json: {
          ...exp,
          params_json: { short_window: 20, long_window: 50 },
          universe_json: { tickers: ["RELIANCE"] },
          cost_model_json: { commission_bps: 1, slippage_bps: 2, initial_cash: 100000 },
          runs: [{ id: "run_1", status: "succeeded", started_at: "2026-02-19", finished_at: "2026-02-19", error: null }],
        },
      });
      return;
    }

    if (url.match(/\/model-lab\/experiments\/[^/]+\/run$/) && method === "POST") {
      await route.fulfill({ json: { run_id: "run_1", status: "queued" } });
      return;
    }

    if (url.match(/\/model-lab\/runs\/[^/]+$/) && method === "GET") {
      runStatusCalls += 1;
      const status = runStatusCalls < 2 ? "running" : "succeeded";
      await route.fulfill({ json: { run_id: "run_1", experiment_id: "exp_1", status } });
      return;
    }

    if (url.match(/\/model-lab\/runs\/[^/]+\/report/) && method === "GET") {
      const runId = url.split("/model-lab/runs/")[1].split("/")[0];
      await route.fulfill({
        json: {
          run_id: runId,
          experiment_id: "exp_1",
          status: "succeeded",
          metrics: {
            cagr: 0.12,
            sharpe: 1.4,
            sortino: 1.8,
            max_drawdown: 0.09,
            vol_annual: 0.2,
            calmar: 1.3,
            win_rate: 0.56,
            turnover: 0.11,
            total_return: 0.18,
          },
          series: {
            equity_curve: [
              { date: "2025-01-01", value: 100000 },
              { date: "2025-01-02", value: 102000 },
              { date: "2025-01-03", value: 101000 },
            ],
            benchmark_curve: [
              { date: "2025-01-01", value: 100000 },
              { date: "2025-01-02", value: 100800 },
              { date: "2025-01-03", value: 101200 },
            ],
            drawdown: [
              { date: "2025-01-01", value: 0 },
              { date: "2025-01-02", value: -0.01 },
              { date: "2025-01-03", value: -0.02 },
            ],
            underwater: [
              { date: "2025-01-01", value: 0 },
              { date: "2025-01-02", value: -0.01 },
              { date: "2025-01-03", value: -0.02 },
            ],
            rolling_sharpe_30: [1.1, 1.2],
            rolling_sharpe_90: [0.9, 1.0],
            monthly_returns: [{ year: 2025, month: 1, return_pct: 2.4 }],
            returns_histogram: { bins: [0.1, 0.2], counts: [2, 1] },
            trades: [{ date: "2025-01-02", action: "BUY", quantity: 10, price: 100 }],
          },
        },
      });
      return;
    }

    if (url.endsWith("/model-lab/compare") && method === "POST") {
      await route.fulfill({
        json: {
          runs: [
            { run_id: "run_1", status: "succeeded", series: { equity_curve: [{ date: "2025-01-01", value: 100000 }], drawdown: [{ date: "2025-01-01", value: -0.01 }] } },
            { run_id: "run_2", status: "succeeded", series: { equity_curve: [{ date: "2025-01-01", value: 101000 }], drawdown: [{ date: "2025-01-01", value: -0.02 }] } },
          ],
          summary: [
            { run_id: "run_1", status: "succeeded", total_return: 0.18, sharpe: 1.4, sortino: 1.8, max_drawdown: 0.09, calmar: 1.3, vol_annual: 0.2, turnover: 0.11, pareto: true },
            { run_id: "run_2", status: "succeeded", total_return: 0.16, sharpe: 1.2, sortino: 1.5, max_drawdown: 0.1, calmar: 1.1, vol_annual: 0.22, turnover: 0.12, pareto: false },
          ],
        },
      });
      return;
    }

    if (url.match(/\/model-lab\/experiments\/[^/]+\/(walk-forward|param-sweep)$/)) {
      await route.fulfill({ json: { ok: true } });
      return;
    }

    await route.continue();
  });

  await page.addInitScript(
    ([at, rt]) => {
      localStorage.setItem("ot-access-token", at);
      localStorage.setItem("ot-refresh-token", rt);
    },
    [accessToken, refreshToken],
  );

  await page.goto("/model-lab");
  await expect(page.getByText("Model Lab", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create Experiment" }).click();
  const openExperimentLink = page.getByRole("link", { name: "Open", exact: true }).first();
  await expect(openExperimentLink).toBeVisible();

  await openExperimentLink.click();
  await expect(page).toHaveURL(/\/model-lab\/experiments\//);
  await expect(page.getByText("Model Lab / Experiment")).toBeVisible();

  await page.goto("/model-lab/runs/run_1", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Model Lab / Report")).toBeVisible();
  await page.goto("/model-lab/compare?runs=run_1,run_2", { waitUntil: "domcontentloaded" });
  await page.locator("input[placeholder='run_id_1,run_id_2,run_id_3']").fill("run_1,run_2");
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByText("Metric Comparison")).toBeVisible();
});
