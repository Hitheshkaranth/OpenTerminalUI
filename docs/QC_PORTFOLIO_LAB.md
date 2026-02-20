# QC Checklist: Portfolio Lab

## Functional
- [ ] Create/list/detail portfolio definitions
- [ ] Create/list strategy blends
- [ ] Run portfolio with and without blend
- [ ] Portfolio report renders KPI tiles/charts/tables/matrix

## Math and Risk Controls
- [ ] Equal weights sanity
- [ ] Vol-target reduces high-vol allocations
- [ ] Risk parity risk contributions approximately equal
- [ ] Max weight cap respected

## Report Contract
- [ ] `metrics`, `series`, `tables`, `matrices` keys stable
- [ ] Correlation matrix labels/values aligned

## Limits and Performance
- [ ] Universe cap validated
- [ ] Blend strategy cap validated
- [ ] Lookback cap validated
- [ ] Cached report retrieval works

## Regression
- [ ] Existing backtesting and model-lab screens still accessible
- [ ] No auth or routing regressions

## Gates
- [ ] Backend tests
- [ ] Frontend build + unit tests
- [ ] Portfolio-lab Playwright E2E
