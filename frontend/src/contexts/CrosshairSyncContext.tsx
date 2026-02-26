import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface CrosshairPos {
  time: number | null;
  sourceSlotId: string | null;
}

interface CrosshairSyncCtx {
  pos: CrosshairPos;
  broadcast: (slotId: string, time: number) => void;
  syncEnabled: boolean;
  toggleSync: () => void;
}

const CrosshairSyncContext = createContext<CrosshairSyncCtx | null>(null);

export function CrosshairSyncProvider({ children }: { children: ReactNode }) {
  const [pos, setPos] = useState<CrosshairPos>({ time: null, sourceSlotId: null });
  const [syncEnabled, setSyncEnabled] = useState(true);
  const rafRef = useRef<number | null>(null);

  const broadcast = useCallback((slotId: string, time: number) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setPos({ time, sourceSlotId: slotId });
    });
  }, []);

  const toggleSync = useCallback(() => setSyncEnabled((v) => !v), []);

  return (
    <CrosshairSyncContext.Provider value={{ pos, broadcast, syncEnabled, toggleSync }}>
      {children}
    </CrosshairSyncContext.Provider>
  );
}

export function useCrosshairSync() {
  const ctx = useContext(CrosshairSyncContext);
  if (!ctx) throw new Error("useCrosshairSync must be inside CrosshairSyncProvider");
  return ctx;
}
