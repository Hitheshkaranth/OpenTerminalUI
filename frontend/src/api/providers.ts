import { useQuery } from "@tanstack/react-query";

import { api } from "./base";

export type ProviderStatus = {
  id: string;
  name: string;
  markets: string[];
  configured: boolean;
  status: "ok" | "degraded" | "down" | "unconfigured";
  last_success_at: string | null;
  last_error: string | null;
  unlocks: string[];
  env_keys: string[];
};

export type ProvidersStatusResponse = {
  checked_at: string;
  overall: "ok" | "degraded" | "down";
  providers: ProviderStatus[];
  error?: string;
};

export async function fetchProvidersStatus(): Promise<ProvidersStatusResponse> {
  const { data } = await api.get("/providers/status");
  return data;
}

export function useProvidersStatus() {
  return useQuery<ProvidersStatusResponse>({
    queryKey: ["providers", "status"],
    queryFn: fetchProvidersStatus,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}