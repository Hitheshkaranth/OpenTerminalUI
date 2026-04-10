# OpenTerminalUI — Codex Swarm Prompts

## How to Run

Each wave contains 4 independent prompts that can run in parallel. The repo now includes a Forge bootstrapper and runner that converts these prompt files into local `.forge/tasks/*.json`, tracks state in `.forge/state.json`, and stores each Codex run under `.forge/results/<TASK-ID>/`.

### Bootstrap Forge from the prompt set
```bash
./scripts/forge init
./scripts/forge list
```

### Run a wave with parallel Codex workers
```bash
./scripts/forge run 1
./scripts/forge run 2 --model gpt-5.4 --max-parallel 4
./scripts/forge run all
```

### Compatibility wrapper
```bash
chmod +x codex-prompts/run-wave.sh
./codex-prompts/run-wave.sh 1
./codex-prompts/run-wave.sh all
```

## Wave Overview

| Wave | Theme | Agents | Features |
|------|-------|--------|----------|
| 1 | Trader Essentials | 4 | Market Heatmap, Time & Sales, Trade Journal, Notification Center |
| 2 | Screening & Discovery | 4 | Custom Formula Screener, Insider Tracker, Options Flow, Alerts v2 |
| 3 | Institutional Analytics | 4 | Factor Attribution, Scenario Stress Test, Correlation Dashboard, Position Sizer |
| 4 | Real-Time Trading | 4 | DOM Ladder, Multi-Timeframe, Hot Key Panel, Workspace Templates |
| 5 | Data Export & Research | 4 | Public REST API, Export Engine, Dividend Dashboard, Relative Strength |
| 6 | Polish & Mobile | 4 | Keyboard Shortcuts, Data Quality, Enhanced Launchpad, Mobile Optimization |

## Integration Check
```bash
./scripts/forge run W1-QC
./scripts/forge run check
```
