import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";

interface CrosshairPos {
  time: number | null;
  sourceSlotId: string | null;
  groupId: string | null;
}

interface CrosshairSyncCtx {
  pos: CrosshairPos;
  broadcast: (slotId: string, time: number | null, groupId?: string | null) => void;
  syncEnabled: boolean;
  toggleSync: () => void;
}

const CrosshairSyncContext = createContext<CrosshairSyncCtx | null>(null);

export function CrosshairSyncProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [pos, setPos] = useState<CrosshairPos>({ time: null, sourceSlotId: null, groupId: null });
  const [syncEnabled, setSyncEnabled] = useState(enabled ?? true);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<CrosshairPos | null>(null);

  useEffect(() => {
    if (typeof enabled === "boolean") setSyncEnabled(enabled);
  }, [enabled]);

  const broadcast = useCallback((slotId: string, time: number | null, groupId?: string | null) => {
    pendingRef.current = { time, sourceSlotId: slotId, groupId: groupId ?? null };
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!pendingRef.current) return;
      setPos(pendingRef.current);
      pendingRef.current = null;
    });
  }, []);

  const toggleSync = useCallback(() => setSyncEnabled((v) => !v), []);
  const value = useMemo(
    () => ({ pos, broadcast, syncEnabled, toggleSync }),
    [pos, broadcast, syncEnabled, toggleSync],
  );

  return (
    <CrosshairSyncContext.Provider value={value}>
      {children}
    </CrosshairSyncContext.Provider>
  );
}

export function useCrosshairSync() {
  const ctx = useContext(CrosshairSyncContext);
  if (!ctx) {
    return {
      pos: { time: null, sourceSlotId: null, groupId: null },
      broadcast: () => undefined,
      syncEnabled: false,
      toggleSync: () => undefined,
    };
  }
  return ctx;
}
