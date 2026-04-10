# TASK: Build Unified Notification Center

## Project Context

OpenTerminalUI is a full-stack financial terminal application.

- **Frontend**: React 18.3.1 + TypeScript + Vite 6 + Tailwind CSS 3.4 + Zustand (state) + TanStack React Query
- **Backend**: FastAPI (Python 3.11) + SQLAlchemy ORM + SQLite
- **UI Pattern**: Dark terminal aesthetic. Components in `frontend/src/components/terminal/`.
- **TopBar**: `frontend/src/components/layout/TopBar.tsx` — the main header bar. This is where the notification bell should go.
- **Alert Toasts**: `frontend/src/components/layout/AlertToasts.tsx` — existing toast notification system.
- **Alerts Store**: `frontend/src/store/alertsStore.ts` — existing alert state management.
- **Heroicons**: `@heroicons/react` is installed. Use `BellIcon`, `BellAlertIcon` from `@heroicons/react/24/outline`.
- **Routing**: React Router 6. Settings page at `frontend/src/pages/Settings.tsx`.
- **API client**: `frontend/src/api/client.ts`.
- **Backend models**: `backend/models/`. Backend routes: `backend/api/routes/`.

## What to Build

### Backend Model: `backend/models/notification.py`

```python
class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, default=1)
    type = Column(String(20), nullable=False)       # alert, news, system, trade
    priority = Column(String(10), default="medium")  # low, medium, high, critical
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    ticker = Column(String(20), nullable=True)
    action_url = Column(String(500), nullable=True)  # deep link within app
    read = Column(Integer, default=0)                 # 0=unread, 1=read
    created_at = Column(DateTime, server_default=func.now())
```

Create Alembic migration for this table.

### Backend Routes: `backend/api/routes/notifications.py`

```
GET    /api/notifications?type=&read=&priority=&limit=50&offset=0
  — List notifications, newest first, with optional filters

GET    /api/notifications/unread-count
  — Returns: { count: number }

PUT    /api/notifications/{id}/read
  — Mark single notification as read

PUT    /api/notifications/read-all
  — Mark all unread as read

DELETE /api/notifications/{id}
  — Delete/dismiss a notification

POST   /api/notifications
  — Create notification (used internally by other services)
  Body: { type, title, body?, ticker?, action_url?, priority? }
```

Register in `backend/main.py` with prefix `/api/notifications`.

### Backend Integration

In `backend/alerts/evaluator.py` (or wherever alerts are triggered): when an alert fires, also create a notification via the notifications route/service with:
- `type: "alert"`
- `title: "Alert: {symbol} {condition}"`
- `action_url: "/equity/alerts"`
- `priority: "high"`

Keep this lightweight — just add a helper function `create_notification(db, type, title, body, ticker, action_url, priority)` in `backend/api/routes/notifications.py` that other modules can import and call.

### Frontend Store: `frontend/src/store/notificationStore.ts`

```typescript
interface Notification {
  id: number;
  type: "alert" | "news" | "system" | "trade";
  priority: "low" | "medium" | "high" | "critical";
  title: string;
  body?: string;
  ticker?: string;
  action_url?: string;
  read: boolean;
  created_at: string;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isOpen: boolean;
  // actions
  fetchNotifications: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: number) => Promise<void>;
  togglePanel: () => void;
}
```

Use Zustand. Fetch unread count on app load and poll every 30 seconds.

### Frontend Component: `frontend/src/components/notifications/NotificationBell.tsx`

- Bell icon button (use `BellIcon` from Heroicons)
- When `unreadCount > 0`: show a red dot badge with count (top-right of bell icon)
- When `unreadCount === 0`: show plain bell icon in `text-terminal-muted`
- On click: toggle `NotificationPanel`
- Animate bell subtly when new notifications arrive (CSS `animate-bounce` for 1 second)

### Frontend Component: `frontend/src/components/notifications/NotificationPanel.tsx`

Dropdown panel (positioned absolute below the bell, right-aligned):

- **Header**: "Notifications" title + "Mark all read" button (right side)
- **Filter tabs**: `All` | `Alerts` | `News` | `System` | `Trades` (small pill buttons)
- **Notification list** (scrollable, max-h-96):
  - Group by: "Today", "Yesterday", "Older" (section headers)
  - Each item:
    - Left: Type icon (bell for alert, newspaper for news, cog for system, chart for trade)
    - Center: title (bold if unread), body preview (truncated 1 line), relative time ("2m ago")
    - Right: priority dot (red=critical, amber=high, blue=medium, gray=low)
    - Unread items have `bg-terminal-accent/5` background
  - Click item: mark as read + navigate to `action_url` if present
  - Swipe or X button to dismiss
- **Footer**: "View All Alerts →" link to `/equity/alerts`
- **Empty state**: "No notifications" with muted text
- Click outside panel → close

### TopBar Integration

In `frontend/src/components/layout/TopBar.tsx`:
- Import and add `<NotificationBell />` before the user account menu / settings icon
- The bell should sit in the top bar's right section alongside existing icons

### Tests

**Backend** (`backend/tests/test_notifications.py`):
```python
# Test POST /api/notifications creates notification
# Test GET /api/notifications returns list ordered by created_at desc
# Test GET /api/notifications?type=alert filters correctly
# Test GET /api/notifications/unread-count returns correct count
# Test PUT /api/notifications/{id}/read marks as read
# Test PUT /api/notifications/read-all marks all as read
# Test DELETE /api/notifications/{id} removes notification
```

**E2E** (`frontend/tests/notification-center.spec.ts`):
```typescript
// Verify bell icon is visible in top bar
// Click bell, verify notification panel dropdown opens
// Verify panel has filter tabs (All, Alerts, News, System, Trades)
// Verify "Mark all read" button is present
// Click outside panel, verify it closes
// If notifications exist, verify they show title and time
```

## Code Style
- Named exports, Tailwind-only styling, terminal color tokens
- `text-terminal-text`, `bg-terminal-panel`, `border-terminal-border`, `text-terminal-accent`
- Heroicons for icons
- Zustand for state (NOT context)
- Type all data with TypeScript interfaces
- Relative time formatting: use `date-fns` `formatDistanceToNow` (already installed)
