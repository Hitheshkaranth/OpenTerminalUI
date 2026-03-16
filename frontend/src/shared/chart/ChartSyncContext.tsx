import { createContext, useContext, useMemo, useRef, useState, useEffect, type ReactNode } from "react";

import { createRafBatcher } from "./rafBatcher";

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
  const publishBatchRef = useRef<ReturnType<typeof createRafBatcher<SyncPayload>> | null>(null);

  if (!publishBatchRef.current) {
    publishBatchRef.current = createRafBatcher<SyncPayload>((next) => {
      setEvent(next);
    });
  }

  useEffect(
    () => () => {
      publishBatchRef.current?.cancel();
    },
    [],
  );

  const value = useMemo<SyncContextValue>(
    () => ({
      event,
      publish: (payload) => publishBatchRef.current?.schedule(payload),
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
