# User Guide: Technical Screener

## Daily workflow
1. Open `Equity -> Screener`.
2. Select a preset from left panel.
3. Click `Run Preset`.
4. Review `Today's Setups` results.
5. Click a row to inspect explainability steps.
6. Click `Open Chart` to jump to stock chart.
7. Set near-trigger slider and click `Create Scanner Alert`.

## Presets
- Built-in presets are auto-seeded on first use.
- You can:
  - edit preset name/universe/rule type
  - save as your own preset
  - delete selected preset

## Results fields
- `setup_type`: detector that matched.
- `signal_age`: bars since event.
- `trend_state`: up/flat/compression/continuation.
- `rvol`, `atr_pct`, `breakout_level`, `distance_to_trigger`.
- `score`: ranking score.

## Explainability
- Right panel shows:
  - computed levels
  - pass/fail rule steps
  - selected row context for alert creation

## Alerts behavior
- Scanner alerts flow through existing Alerts channel.
- Event types:
  - `near_trigger`
  - `triggered`
  - `invalidation`
- Dedupe defaults to 15 minutes per symbol+rule.
