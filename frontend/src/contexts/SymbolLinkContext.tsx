import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type LinkGroup = "none" | "red" | "blue" | "green" | "yellow";

export type SymbolLinkBroadcastMessage =
  | {
      type: "symbol-change";
      sourceWindowId: string;
      linkGroup: LinkGroup;
      symbol: string | null;
    }
  | {
      type: "theme-change";
      sourceWindowId: string;
      theme: string;
    }
  | {
      type: "panel-return";
      sourceWindowId: string;
      panelId?: string;
      linkGroup?: LinkGroup;
    };

export interface LinkGroupState {
  group: LinkGroup;
  symbol: string | null;
  source: string | null;
  version: number;
}

export interface SymbolLinkContextValue {
  getGroupSymbol: (group: LinkGroup) => string | null;
  getGroupState: (group: LinkGroup) => LinkGroupState;
  setGroupSymbol: (group: LinkGroup, symbol: string | null, source?: string | null) => void;
  subscribeGroupSymbols: (listener: () => void) => () => void;
  getPanelLinkGroup: (panelId: string) => LinkGroup;
  setPanelLinkGroup: (panelId: string, group: LinkGroup) => void;
  cycleLinkGroup: (group: LinkGroup) => LinkGroup;
  subscribePanelLinkGroups: (listener: () => void) => () => void;
}

const LINK_GROUP_ORDER: Exclude<LinkGroup, "none">[] = ["red", "blue", "green", "yellow"];

const groupStates: Record<Exclude<LinkGroup, "none">, LinkGroupState> = {
  red: { group: "red", symbol: null, source: null, version: 0 },
  blue: { group: "blue", symbol: null, source: null, version: 0 },
  green: { group: "green", symbol: null, source: null, version: 0 },
  yellow: { group: "yellow", symbol: null, source: null, version: 0 },
};

const panelGroups = new Map<string, LinkGroup>();
const groupListeners = new Set<() => void>();
const panelListeners = new Set<() => void>();
const messageListeners = new Set<(message: SymbolLinkBroadcastMessage) => void>();
const BROADCAST_CHANNEL_NAME = "ot-symbol-link";
const WINDOW_ID = makeWindowId();

let broadcastChannel: BroadcastChannel | null = null;
let unloadListenerInstalled = false;

function normalizeSymbol(symbol: string | null | undefined): string | null {
  const next = typeof symbol === "string" ? symbol.trim() : "";
  return next ? next : null;
}

function makeWindowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ot-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function isBroadcastMessage(value: unknown): value is SymbolLinkBroadcastMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SymbolLinkBroadcastMessage>;
  if (row.type === "symbol-change") {
    return typeof row.sourceWindowId === "string" && typeof row.linkGroup === "string";
  }
  if (row.type === "theme-change") {
    return typeof row.sourceWindowId === "string" && typeof row.theme === "string";
  }
  if (row.type === "panel-return") {
    return typeof row.sourceWindowId === "string";
  }
  return false;
}

function closeBroadcastChannel() {
  if (!broadcastChannel) return;
  broadcastChannel.removeEventListener("message", handleBroadcastMessage);
  broadcastChannel.close();
  broadcastChannel = null;
}

function ensureBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "undefined") return null;
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.addEventListener("message", handleBroadcastMessage);
    if (!unloadListenerInstalled) {
      window.addEventListener("pagehide", closeBroadcastChannel, { once: true });
      window.addEventListener("beforeunload", closeBroadcastChannel, { once: true });
      unloadListenerInstalled = true;
    }
  }
  return broadcastChannel;
}

function handleBroadcastMessage(event: MessageEvent<unknown>) {
  const message = event.data;
  if (!isBroadcastMessage(message)) return;
  if (message.sourceWindowId === WINDOW_ID) return;
  if (message.type === "symbol-change" && message.linkGroup !== "none") {
    setGroupSymbol(message.linkGroup, message.symbol, message.sourceWindowId, false);
  }
  for (const listener of messageListeners) listener(message);
}

export function postSymbolLinkMessage(message: SymbolLinkBroadcastMessage): void {
  const channel = ensureBroadcastChannel();
  if (!channel) return;
  channel.postMessage(message);
}

function readGroupState(group: LinkGroup): LinkGroupState {
  if (group === "none") {
    return { group: "none", symbol: null, source: null, version: 0 };
  }
  return groupStates[group];
}

function notifyGroupListeners() {
  for (const listener of groupListeners) listener();
}

function notifyPanelListeners() {
  for (const listener of panelListeners) listener();
}

function getStoredPanelGroup(panelId: string): LinkGroup {
  return panelGroups.get(panelId) ?? "none";
}

function setStoredPanelGroup(panelId: string, group: LinkGroup): void {
  const next = group === "none" ? "none" : group;
  if (panelGroups.get(panelId) === next) return;
  panelGroups.set(panelId, next);
  notifyPanelListeners();
}

export const SymbolLinkContext = createContext<SymbolLinkContextValue | null>(null);

export function SymbolLinkProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: Partial<SymbolLinkContextValue>;
}) {
  const api: SymbolLinkContextValue = {
    getGroupSymbol,
    getGroupState,
    setGroupSymbol,
    subscribeGroupSymbols,
    getPanelLinkGroup: getStoredPanelGroup,
    setPanelLinkGroup: setStoredPanelGroup,
    cycleLinkGroup,
    subscribePanelLinkGroups,
    ...(value ?? {}),
  };

  return <SymbolLinkContext.Provider value={api}>{children}</SymbolLinkContext.Provider>;
}

export function useSymbolLinkContext(): SymbolLinkContextValue {
  return useContext(SymbolLinkContext) ?? {
    getGroupSymbol,
    getGroupState,
    setGroupSymbol,
    subscribeGroupSymbols,
    getPanelLinkGroup: getStoredPanelGroup,
    setPanelLinkGroup: setStoredPanelGroup,
    cycleLinkGroup,
    subscribePanelLinkGroups,
  };
}

export function getGroupState(group: LinkGroup): LinkGroupState {
  return readGroupState(group);
}

export function getGroupSymbol(group: LinkGroup): string | null {
  return readGroupState(group).symbol;
}

export function setGroupSymbol(
  group: LinkGroup,
  symbol: string | null,
  source?: string | null,
  broadcast = true,
): void {
  if (group === "none") return;
  const nextSymbol = normalizeSymbol(symbol);
  const nextSource = source ?? null;
  const current = groupStates[group];
  if (current.symbol === nextSymbol && current.source === nextSource) return;
  groupStates[group] = {
    group,
    symbol: nextSymbol,
    source: nextSource,
    version: current.version + 1,
  };
  notifyGroupListeners();
  if (broadcast) {
    postSymbolLinkMessage({
      type: "symbol-change",
      sourceWindowId: nextSource ?? WINDOW_ID,
      linkGroup: group,
      symbol: nextSymbol,
    });
  }
}

export function subscribeGroupSymbols(listener: () => void): () => void {
  groupListeners.add(listener);
  ensureBroadcastChannel();
  return () => {
    groupListeners.delete(listener);
  };
}

export function getPanelLinkGroup(panelId: string): LinkGroup {
  return getStoredPanelGroup(panelId);
}

export function setPanelLinkGroup(panelId: string, group: LinkGroup): void {
  setStoredPanelGroup(panelId, group);
}

export function cycleLinkGroup(group: LinkGroup): LinkGroup {
  if (group === "none") return LINK_GROUP_ORDER[0];
  const index = LINK_GROUP_ORDER.indexOf(group);
  if (index < 0) return LINK_GROUP_ORDER[0];
  if (index === LINK_GROUP_ORDER.length - 1) return "none";
  return LINK_GROUP_ORDER[index + 1];
}

export function subscribePanelLinkGroups(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => {
    panelListeners.delete(listener);
  };
}

export function subscribeSymbolLinkMessages(
  listener: (message: SymbolLinkBroadcastMessage) => void,
): () => void {
  messageListeners.add(listener);
  ensureBroadcastChannel();
  return () => {
    messageListeners.delete(listener);
  };
}

export function useGroupSymbolState(group: LinkGroup): LinkGroupState {
  return useSyncExternalStore(
    subscribeGroupSymbols,
    () => readGroupState(group),
    () => readGroupState(group),
  );
}

export function useGroupSymbol(group: LinkGroup): string | null {
  return useGroupSymbolState(group).symbol;
}

export function usePanelLinkGroup(panelId: string, defaultGroup: LinkGroup = "none"): LinkGroup {
  return useSyncExternalStore(
    subscribePanelLinkGroups,
    () => getStoredPanelGroup(panelId) ?? defaultGroup,
    () => defaultGroup,
  );
}
