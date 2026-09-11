import { api } from "./base";

export interface AuditEvent {
  id: string;
  user_id: string | null;
  username?: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  ip_address?: string;
}

export interface AuditListResponse {
  items: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchAuditEvents(params?: {
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