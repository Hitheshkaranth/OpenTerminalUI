import { api } from "./base";
import type {
  PluginManifestItem,
} from "../types";

export async function fetchPlugins(): Promise<PluginManifestItem[]> {
  const { data } = await api.get<{ items: PluginManifestItem[] }>("/plugins");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  await api.post(`/plugins/${encodeURIComponent(pluginId)}/${enabled ? "enable" : "disable"}`);
}

export async function reloadPlugin(pluginId: string): Promise<void> {
  await api.post(`/plugins/${encodeURIComponent(pluginId)}/reload`);
}
