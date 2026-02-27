import { addPortfolioHolding, fetchPortfolios } from "../api/client";

export async function quickAddToFirstPortfolio(symbol: string, costHint?: number, notes = "Added from chart context menu"): Promise<boolean> {
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) return false;
  const portfolios = await fetchPortfolios();
  const target = portfolios[0];
  if (!target) return false;
  const cost = Number.isFinite(Number(costHint)) && Number(costHint) > 0 ? Number(costHint) : 1;
  await addPortfolioHolding(target.id, {
    symbol: clean,
    shares: 1,
    cost_basis_per_share: cost,
    purchase_date: new Date().toISOString().slice(0, 10),
    notes,
  });
  return true;
}
