import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import type { OptionChainData } from "../../types/market";

const API = import.meta.env.VITE_API_BASE_URL || "";

interface UseOptionChainOpts {
  underlying: string;
  expiry?: string;
  provider?: string;
  enabled?: boolean;
  refetchInterval?: number;
}

export function useOptionChain({
  underlying,
  expiry,
  provider,
  enabled = true,
  refetchInterval = 5000,
}: UseOptionChainOpts) {
  return useQuery<OptionChainData>({
    queryKey: ["optionChain", underlying, expiry, provider],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (expiry) params.expiry = expiry;
      if (provider) params.provider = provider;
      const res = await axios.get(`${API}/api/options/chain/${underlying}`, { params });
      return res.data;
    },
    enabled: !!underlying && enabled,
    refetchInterval,
    staleTime: 3000,
    retry: 2,
  });
}
