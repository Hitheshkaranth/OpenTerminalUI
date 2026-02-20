import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

test("portfolio lab e2e: create portfolio -> run -> report and create blend", async ({ page }) => {
  const accessToken = makeJwt({ sub: "e2e-user", email: "e2e@example.com", role: "trader", exp: Math.floor(Date.now() / 1000) + 3600 });
  const refreshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });

  const portfolios = [{ id: "pf_1", name: "Core Portfolio", description: "", tags: ["core"], benchmark_symbol: "NIFTY50", start_date: "2025-01-01", end_date: "2025-12-31", rebalance_frequency: "WEEKLY", weighting_method: "RISK_PARITY", created_at: "2026-02-20" }];
  const blends = [{ id: "blend_1", name: "Balanced Blend", strategies_json: [{ model_key: "sma_crossover", weight: 0.5 }, { model_key: "mean_reversion", weight: 0.5 }], blend_method: "WEIGHTED_SUM_RETURNS" }];

  await page.route("**/api/portfolio-lab/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.endsWith("/portfolio-lab/portfolios") && method === "GET") {
      await route.fulfill({ json: { items: portfolios } });
      return;
    }
    if (url.endsWith("/portfolio-lab/portfolios") && method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const created = {
        id: `pf_${portfolios.length + 1}`,
        name: String(body.name || "New Portfolio"),
        description: String(body.description || ""),
        tags: Array.isArray(body.tags) ? body.tags : [],
        benchmark_symbol: String(body.benchmark_symbol || ""),
        start_date: String(body.start_date || "2025-01-01"),
        end_date: String(body.end_date || "2025-12-31"),
        rebalance_frequency: String(body.rebalance_frequency || "WEEKLY"),
        weighting_method: String(body.weighting_method || "EQUAL"),
        created_at: "2026-02-20",
      };
      portfolios.unshift(created);
      await route.fulfill({ json: created });
      return;
    }
    if (url.includes("/portfolio-lab/portfolios/") && method === "GET" && !url.includes("/run")) {
      const id = url.split("/portfolio-lab/portfolios/")[1].split("?")[0];
      const portfolio = portfolios.find((p) => p.id === id) || portfolios[0];
      await route.fulfill({ json: { ...portfolio, universe_json: { tickers: ["RELIANCE", "TCS"] }, constraints_json: { max_weight: 0.25 }, runs: [{ run_id: "pr_1", portfolio_id: portfolio.id, blend_id: "blend_1", status: "succeeded", started_at: "2026-02-20", finished_at: "2026-02-20", error: null }] } });
      return;
    }
    if (url.includes("/portfolio-lab/portfolios/") && url.endsWith("/run") && method === "POST") {
      await route.fulfill({ json: { run_id: "pr_1", portfolio_id: "pf_1", blend_id: "blend_1", status: "succeeded", started_at: "2026-02-20", finished_at: "2026-02-20", error: null } });
      return;
    }
    if (url.includes("/portfolio-lab/runs/") && url.includes("/report") && method === "GET") {
      await route.fulfill({ json: {
        run_id: "pr_1",
        portfolio_id: "pf_1",
        blend_id: "blend_1",
        status: "succeeded",
        metrics: { cagr: 0.12, sharpe: 1.4, sortino: 1.7, max_drawdown: 0.09, vol_annual: 0.2, calmar: 1.3, turnover: 0.11, beta: 0.95 },
        series: {
          portfolio_equity: [{ date: "2025-01-01", value: 100000 }, { date: "2025-01-02", value: 101200 }],
          benchmark_equity: [{ date: "2025-01-01", value: 100000 }, { date: "2025-01-02", value: 100900 }],
          drawdown: [{ date: "2025-01-01", value: 0 }, { date: "2025-01-02", value: -0.01 }],
          underwater: [{ date: "2025-01-01", value: 0 }, { date: "2025-01-02", value: -0.01 }],
          exposure: [{ date: "2025-01-01", value: 1.0 }],
          leverage: [{ date: "2025-01-01", value: 1.0 }],
          returns: [{ date: "2025-01-01", return: 0.0 }, { date: "2025-01-02", return: 0.012 }],
          weights_over_time: [{ date: "2025-01-01", weights: { RELIANCE: 0.5, TCS: 0.5 } }],
          turnover_series: [{ date: "2025-01-01", turnover: 0.2 }],
          contribution_series: [{ date: "2025-01-01", RELIANCE: 0.005, TCS: 0.004 }],
          rolling_sharpe_30: [{ date: "2025-01-02", value: 1.2 }],
          rolling_sharpe_90: [{ date: "2025-01-02", value: 1.0 }],
          rolling_volatility: [{ date: "2025-01-02", value: 0.18 }],
          monthly_returns: [{ year: 2025, month: 1, return_pct: 2.2 }],
        },
        tables: {
          top_contributors: [{ asset: "RELIANCE", contribution: 0.03 }],
          top_detractors: [{ asset: "TCS", contribution: -0.01 }],
          worst_drawdowns: [{ date: "2025-01-02", drawdown: -0.01 }],
          rebalance_log: [{ date: "2025-01-01", turnover: 0.2 }],
          latest_weights: [{ asset: "RELIANCE", weight: 0.5 }, { asset: "TCS", weight: 0.5 }],
        },
        matrices: {
          correlation: { labels: ["RELIANCE", "TCS"], values: [[1, 0.4], [0.4, 1]], cluster_order: [0, 1] },
          labels: ["RELIANCE", "TCS"],
          cluster_order: [0, 1],
        },
      } });
      return;
    }
    if (url.endsWith("/portfolio-lab/blends") && method === "GET") {
      await route.fulfill({ json: { items: blends } });
      return;
    }
    if (url.endsWith("/portfolio-lab/blends") && method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const created = { id: `blend_${blends.length + 1}`, name: String(body.name || "New Blend"), strategies_json: Array.isArray(body.strategies_json) ? body.strategies_json : [], blend_method: String(body.blend_method || "WEIGHTED_SUM_RETURNS") };
      blends.unshift(created);
      await route.fulfill({ json: created });
      return;
    }

    await route.continue();
  });

  await page.addInitScript(([at, rt]) => {
    localStorage.setItem("ot-access-token", at);
    localStorage.setItem("ot-refresh-token", rt);
  }, [accessToken, refreshToken]);

  await page.goto("/portfolio-lab");
  await expect(page.getByRole("button", { name: "Create Portfolio" })).toBeVisible();

  await page.getByRole("button", { name: "Create Portfolio" }).click();

  await page.goto("/portfolio-lab/runs/pr_1", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Portfolio Lab / Report")).toBeVisible();

  await page.goto("/portfolio-lab/blends", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Blend Builder")).toBeVisible();
  await page.getByRole("button", { name: "Save Blend" }).click();
  await expect(page.getByText("Saved Blends")).toBeVisible();
});
