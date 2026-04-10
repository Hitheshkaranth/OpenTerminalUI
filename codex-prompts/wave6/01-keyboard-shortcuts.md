# TASK: Build Customizable Keyboard Shortcut System

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend. Existing keyboard handling: CommandBar (GO bar, Ctrl+G) at `frontend/src/components/layout/CommandBar.tsx`, CommandPalette (Ctrl+K) at `frontend/src/components/layout/CommandPalette.tsx`. Function keys F1-F9 handled in `TerminalShell.tsx`. Settings page at `frontend/src/pages/Settings.tsx`. Terminal dark theme. Tests: Playwright.

## What to Build

### Frontend: `frontend/src/hooks/useKeyboardShortcuts.ts`

Central keyboard shortcut registry and handler:

```typescript
interface Shortcut {
  id: string;
  keys: string;              // e.g., "ctrl+g", "shift+b", "f1"
  label: string;
  description: string;
  category: "navigation" | "trading" | "charts" | "panels" | "general";
  action: () => void;
  context?: string;          // optional: only active in certain contexts (e.g., "chart", "table")
  enabled?: boolean;
}

interface ShortcutRegistry {
  shortcuts: Map<string, Shortcut>;
  register: (shortcut: Omit<Shortcut, "action"> & { action: () => void }) => void;
  unregister: (id: string) => void;
  rebind: (id: string, newKeys: string) => void;
  getByCategory: (category: string) => Shortcut[];
  resetToDefaults: () => void;
}
```

**Default shortcuts**:
```
Navigation:
  ctrl+g     — Open GO bar
  ctrl+k     — Open command palette
  ctrl+/     — Show keyboard shortcuts overlay
  ctrl+b     — Toggle sidebar
  ctrl+1-9   — Switch to tab by position (if tabs exist)
  f1         — Market page
  f2         — Screener
  f3         — Portfolio
  f4         — Watchlist
  f5         — News
  f6         — Settings
  f9         — Backtesting

Panels:
  ctrl+shift+f — Toggle current panel fullscreen
  ctrl+w       — Close current panel (in launchpad)

Trading:
  ctrl+t     — Toggle hot key trading panel

Charts:
  +/=        — Zoom in chart
  -          — Zoom out chart
  left/right — Pan chart

General:
  ?          — Show shortcuts overlay (when not in input)
  esc        — Close any open modal/panel
```

**Key parsing**: Parse key combos like "ctrl+shift+k" into normalized form. Handle both Mac (Cmd) and Windows (Ctrl).

**Conflict detection**: When rebinding, check if new combo conflicts with existing shortcut. Show warning if so.

**Persistence**: Store custom bindings in Zustand store persisted to localStorage.

### Frontend: `frontend/src/store/shortcutStore.ts`

```typescript
interface ShortcutState {
  customBindings: Record<string, string>;  // {shortcut_id: custom_keys}
  setBinding: (id: string, keys: string) => void;
  resetBinding: (id: string) => void;
  resetAll: () => void;
  getEffectiveKeys: (id: string) => string;  // returns custom or default
}
```

### Frontend: `frontend/src/components/layout/ShortcutOverlay.tsx`

Full-screen overlay triggered by Ctrl+/ or ?:

- Semi-transparent dark backdrop
- Centered card with max-w-2xl
- Title: "Keyboard Shortcuts"
- Search input at top (filter shortcuts by label/description)
- Grouped by category: Navigation, Trading, Charts, Panels, General
- Each shortcut row: description (left) + key combo badge (right)
- Key combo shown as styled kbd elements: `<kbd>Ctrl</kbd> + <kbd>G</kbd>`
- "Customize" link at bottom → navigates to Settings shortcut manager
- Close with Esc or click backdrop

### Frontend: `frontend/src/components/settings/ShortcutManager.tsx`

Section in Settings page for managing shortcuts:

- Searchable list of all shortcuts grouped by category
- Each row: description | current key combo | "Edit" button
- Click "Edit" → row enters edit mode:
  - Shows "Press new key combination..." text
  - Listens for next keypress combo
  - Shows conflict warning if combo already in use
  - "Save" / "Cancel" / "Reset to Default" buttons
- "Reset All to Defaults" button at top
- "Export Config" / "Import Config" buttons (JSON copy/paste)

### Integration

1. In `frontend/src/components/layout/TerminalShell.tsx`:
   - Initialize the shortcut registry with all default shortcuts
   - Set up global keydown listener that routes to the registry
   - Ignore shortcuts when focus is in text inputs (unless explicitly marked)

2. Add ShortcutOverlay to the app root (rendered alongside CommandBar and CommandPalette)

3. Add ShortcutManager section to Settings page

### Tests

**E2E** (`frontend/tests/keyboard-shortcuts.spec.ts`):
```typescript
// Press Ctrl+/, verify shortcuts overlay opens
// Verify shortcuts are grouped by category
// Search for "palette", verify Ctrl+K shortcut shown
// Press Esc, verify overlay closes
// Navigate to Settings, find Shortcut Manager section
// Click "Edit" on a shortcut, press new key combo, verify it updates
// Click "Reset All", verify defaults restored
```
