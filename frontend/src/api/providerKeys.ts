import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

import { api } from "./base";

export type ProviderKeyRow = {
  name: string;
  provider: string;
  set: boolean;
  masked: string | null;
  source: "env_file" | "process" | "unset";
};

export type ProviderKeysResponse = {
  env_file: string;
  keys: ProviderKeyRow[];
  applied_live?: string[];
  restart_required?: string[];
};

export type ProviderTestResult = {
  provider: string;
  status: "ok" | "degraded" | "down" | "unconfigured";
  last_error: string | null;
  checked_at: string;
};

export async function fetchProviderKeys(): Promise<ProviderKeysResponse> {
  const { data } = await api.get("/settings/provider-keys");
  return data;
}

export async function saveProviderKeys(values: Record<string, string>): Promise<ProviderKeysResponse> {
  const { data } = await api.put("/settings/provider-keys", { values });
  return data;
}

export async function testProvider(providerId: string): Promise<ProviderTestResult> {
  const { data } = await api.post(`/settings/provider-keys/test/${providerId}`);
  return data;
}

export function useProviderKeys(enabled: boolean) {
  return useQuery<ProviderKeysResponse>({
    queryKey: ["settings", "provider-keys"],
    queryFn: fetchProviderKeys,
    staleTime: 30_000,
    retry: 0,
    enabled,
  });
}