import { api } from "./base";
import type { AuditEvent } from "../types";

export interface AuditListResponse {
  items: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchAuditEventsApi(params?: {
  event_type?: string;
  entity_type?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditListResponse> {
  const { data } = await api.get<AuditListResponse>("/audit", { params });
  return data;
}

export async function fetchAuditEventDetail(eventId: string): Promise<AuditEvent> {
  const { data } = await api.get<AuditEvent>(`/audit/${eventId}`);
  return data;
}