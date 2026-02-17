import { describe, expect, it } from "vitest";

import { useAlertsStore } from "../store/alertsStore";

describe("alertsStore", () => {
  it("increments and resets unread count", () => {
    useAlertsStore.getState().resetUnread();
    useAlertsStore.getState().incrementUnread();
    useAlertsStore.getState().incrementUnread();
    expect(useAlertsStore.getState().unreadCount).toBe(2);
    useAlertsStore.getState().resetUnread();
    expect(useAlertsStore.getState().unreadCount).toBe(0);
  });
});
