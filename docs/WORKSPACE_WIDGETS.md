# Workspace widgets and portable layouts

Register trusted, bundled React widgets before mounting the application. The same registry powers the Add Panel menu, workspace rendering, popout rendering, and portable-layout validation.

```tsx
import { registerWorkspaceWidget, type LaunchpadPanelConfig } from "../components/layout/LaunchpadContext";

function ExposureWidget({ panel }: { panel: LaunchpadPanelConfig }) {
  return <div>Selected instrument: {panel.symbol || "Choose an instrument"}</div>;
}

registerWorkspaceWidget({
  id: "plugin:exposure",
  title: "Exposure",
  version: 1,
  component: ExposureWidget,
});
```

IDs must be unique and use `plugin:` followed by lowercase letters, digits, or hyphens. Components receive the panel ID, title, symbol, link group, grid geometry, and JSON properties. Use the existing authenticated API client and TanStack Query for data. Query keys must include every parameter that changes the response. Implement loading, unavailable, and error states; do not synthesize missing values. Registration does not execute downloaded code and is not a plugin sandbox. Bundle each extension into the app and popout entry points.

## Shared context

Layouts optionally contain `groups` keyed by `red`, `blue`, `green`, and `yellow`. Each group has a name and optional symbol, dateRange (`from`, `to` ISO dates), and reporting currency (`USD` or `INR`). Applying group context updates matching panels and preserves unlinked panels. Joining a configured group adopts its context. Existing layouts without groups keep their symbol-link behavior.

Widgets receive group settings through `panel.props.dateRange`, `panel.props.reportingCurrency`, and `panel.props.contextName`. Charts filter the available source history, and portfolio performance filters its returned curve. Other panels continue to show their source periods. Currency is a reporting request, not permission to relabel source values: widgets must explicitly convert with sourced FX data or state that conversion is unavailable.

## Export, import and undo

Use the workspace toolbar to export the active layout, import a new layout, or undo the last layout change. Export JSON uses format `openterminal-workspace` and version `1`. Import accepts up to 2 MB and 48 panels, validates registered panel types and grid bounds, generates new IDs, and clears external-window state. Credential-shaped property keys are stripped on import/export; this is a convenience safeguard, not a substitute for keeping credentials out of widget properties. Imports append a layout and never overwrite another layout. Undo keeps the last 30 layout edits in memory; server hydration is not an undoable user edit.

## Pin research evidence

```ts
import { queuePinnedArtifact } from "../workspace/pinnedArtifacts";
queuePinnedArtifact({
  artifact: { id: "unique-result-id", kind: "table", name: "Comparison", data: result },
  savedAt: new Date().toISOString(),
});
```

The queue is stored in session storage until Launchpad finishes loading saved layouts. A custom event delivers it immediately when Launchpad is already open. Repeating the same artifact ID does not add a duplicate to the active layout. Saved artifacts are static evidence snapshots, labelled with capture time; they do not imply current market data. Widget renderers should preserve provenance carried in their result data.

## Implemented roadmap acceptance

- Former placeholder panels for allocation, performance, risk metrics, economics, Greeks, open interest, and peers use the existing authenticated APIs. Missing peer values are shown as unavailable. API failures link to provider settings.
- The same registry renders main-window and popout panels. The Add Panel menu includes the completed panels and registered extensions.
- Panel settings edit titles and instruments, chart history range, derivatives expiry, and portfolio benchmark. Relevant settings participate in data query keys.
- Workspace exports preserve groups and panel settings. Invalid versions, unregistered types, malformed geometry, excessive size, and reversed group dates are rejected. Imports receive new IDs. Undo restores import and panel removal. Repeated evidence pin events are deduplicated.
- Named context applies only to the matching link color. Joining a configured group adopts its settings; symbol broadcasts keep the saved group symbol current. Focused group date and currency intent reach the agent context.
- Display settings persist density, text scale, and optional decorative overlays. Default tables respect the density preference. Data typography tokens scale along with rem-based controls.
- The screener has a compact summary and collapsed rule editor by default, with selected rows, active filters, and universe shared with the agent.
- Provider onboarding lists actual provider connection states and capabilities without treating configured credentials as healthy coverage.
- Monitoring offers watchlist and alert views with loading/error recovery, touch-sized tabs, mobile navigation links, and a compact mobile shell. Mobile layouts stack panels without overwriting desktop geometry.

## Validation and limits

Unit coverage includes portable validation, import/undo, pin deduplication, named contexts, widget registration, live response rendering, unavailable values, provider recovery, and display preferences. Browser smoke checks used mocked APIs to verify allocation rendering, undo, group apply, JSON download, settings changes, and mobile monitoring at 390×844 without horizontal page overflow. Mocked checks do not certify live-provider data accuracy or entitlement coverage.

Currency context is not an FX conversion engine. Charts retain and disclose their source currency. Group dates filter the source history available to the widget; they do not manufacture earlier observations or turn current fundamentals into historical point-in-time data. Portfolio/performance panels use the existing default-portfolio endpoints, not a new multi-portfolio selection backend. Extension registration is for bundled trusted code, not untrusted runtime package installation. Undo is session-local and does not provide collaboration conflict resolution. Some legacy components still use fixed pixel sizes or explicit compact density; their visual sizing may not fully follow the global preference.
