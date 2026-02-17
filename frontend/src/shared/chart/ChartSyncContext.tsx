import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type SyncPayload = {
  sourceId: string;
  timestamp: number;
  price: number;
};

type SyncContextValue = {
  event: SyncPayload | null;
  publish: (payload: SyncPayload) => void;
};

const ChartSyncContext = createContext<SyncContextValue | null>(null);

export function ChartSyncProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<SyncPayload | null>(null);
  const value = useMemo<SyncContextValue>(
    () => ({
      event,
      publish: (payload) => setEvent(payload),
    }),
    [event],
  );
  return <ChartSyncContext.Provider value={value}>{children}</ChartSyncContext.Provider>;
}

export function useChartSync(): SyncContextValue {
  const ctx = useContext(ChartSyncContext);
  if (!ctx) {
    return {
      event: null,
      publish: () => undefined,
    };
  }
  return ctx;
}
