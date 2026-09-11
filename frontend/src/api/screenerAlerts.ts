import { api } from "./base";

export interface ScreenerAlertResponse {
  status: string;
  alert: {
    id: string;
    name: string;
    ticker: string;
    channels: string[];
  };
}

export async function createScreenerAlert(
  name: string,
  screenerConfig: Record<string, unknown>,
  deliveryChannels?: string[],
  ticker?: string,
): Promise<ScreenerAlertResponse> {
  const { data } = await api.post<ScreenerAlertResponse>("/screener-alerts", {
    name,
    screener_config: screenerConfig,
    delivery_channels: deliveryChannels,
    ticker,
  });
  return data;
}