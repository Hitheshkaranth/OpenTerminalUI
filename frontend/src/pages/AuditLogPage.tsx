import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchAuditEvents } from "../api/audit";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTable } from "../components/terminal/TerminalTable";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalModal } from "../components/terminal/TerminalModal";
import { TerminalSelect } from "../components/terminal/TerminalSelect";

const EVENT_TYPES = [
  "all",
  "create",
  "update",
  "delete",
  "login",
  "logout",
  "trade",
  "order",
  "query",
  "export",
  "config_change",
  "error",
];

const PAGE_SIZE = 25;

function truncatePayload(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return "{}";
  return JSON.stringify(payload).slice(0, 80) + (JSON.stringify(payload).length > 80 ? "..." : "");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function entityTypeBadge(type: string): "accent" | "neutral" | "info" {
  if (type === "order" || type === "trade") return "accent";
  if (type === "user" || type === "session") return "info";
  return "neutral";
}

function eventSeverity(eventType: string): "success" | "warn" | "danger" | "info" {
  if (["delete", "error", "logout"].includes(eventType)) return "danger";
  if (["update", "config_change"].includes(eventType)) return "warn";
  if (["login", "trade", "order"].includes(eventType)) return "success";
  return "info";
}

export function AuditLogPage() {
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [page, setPage] = useState(0);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["audit-log", eventTypeFilter, page],
    queryFn: () =>
      fetchAuditEvents({
        event_type: eventTypeFilter === "all" ? undefined : eventTypeFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    staleTime: 10_000,
  });

  const events = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const selectedEventDetail = events.find((e) => e.id === selectedEvent);

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-terminal-accent">Audit Log</div>
          <div className="text-[11px] text-terminal-muted">
            {total} events · {isLoading ? "Loading..." : isFetching ? "Refreshing..." : `Page ${page + 1} of ${totalPages || 1}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TerminalSelect
            size="sm"
            tone="ui"
            value={eventTypeFilter}
            onChange={(e) => {
              setEventTypeFilter(e.target.value);
              setPage(0);
            }}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All Events" : t}
              </option>
            ))}
          </TerminalSelect>
        </div>
      </div>

      <TerminalPanel title="Event Timeline">
        <TerminalTable
          rows={events}
          rowKey={(r) => r.id}
          onRowSelect={(index) => {
            if (events[index]) setSelectedEvent(events[index].id);
          }}
          columns={[
            {
              key: "event_type",
              label: "Event Type",
              render: (r) => (
                <span className="inline-flex items-center gap-1">
                  <TerminalBadge variant={eventSeverity(r.event_type)} dot>
                    {r.event_type}
                  </TerminalBadge>
                </span>
              ),
            },
            {
              key: "entity_type",
              label: "Entity",
              render: (r) => (
                <TerminalBadge variant={entityTypeBadge(r.entity_type)}>
                  {r.entity_type}
                </TerminalBadge>
              ),
            },
            {
              key: "entity_id",
              label: "Entity ID",
              render: (r) => r.entity_id ? <span className="font-mono text-[11px]">{r.entity_id}</span> : <span className="text-terminal-muted">-</span>,
            },
            {
              key: "user_id",
              label: "User",
              render: (r) => (
                <span className="font-mono text-[11px]">
                  {r.username || (r.user_id ? `user:${r.user_id.slice(0, 8)}` : "-")}
                </span>
              ),
            },
            {
              key: "payload",
              label: "Payload",
              render: (r) => (
                <pre className="max-w-xs truncate text-[10px] font-mono text-terminal-muted">
                  {truncatePayload(r.payload)}
                </pre>
              ),
            },
            {
              key: "created_at",
              label: "Timestamp",
              render: (r) => <span className="text-[11px]">{formatDate(r.created_at)}</span>,
            },
          ]}
        />
      </TerminalPanel>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <TerminalButton
            variant="default"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Prev
          </TerminalButton>
          <span className="text-xs text-terminal-muted">
            {page + 1} / {totalPages}
          </span>
          <TerminalButton
            variant="default"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next →
          </TerminalButton>
        </div>
      )}

      <TerminalModal
        open={Boolean(selectedEventDetail)}
        onClose={() => setSelectedEvent(null)}
        title="Event Details"
        subtitle={selectedEventDetail?.event_type || ""}
      >
        {selectedEventDetail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-terminal-muted">Event ID</div>
                <div className="font-mono text-terminal-text">{selectedEventDetail.id}</div>
              </div>
              <div>
                <div className="text-terminal-muted">User</div>
                <div className="font-mono text-terminal-text">
                  {selectedEventDetail.username || (selectedEventDetail.user_id ? `user:${selectedEventDetail.user_id.slice(0, 8)}` : "-")}
                </div>
              </div>
              <div>
                <div className="text-terminal-muted">Event Type</div>
                <div className="text-terminal-text">{selectedEventDetail.event_type}</div>
              </div>
              <div>
                <div className="text-terminal-muted">Entity Type</div>
                <div className="text-terminal-text">{selectedEventDetail.entity_type}</div>
              </div>
              <div>
                <div className="text-terminal-muted">Entity ID</div>
                <div className="font-mono text-terminal-text">
                  {selectedEventDetail.entity_id || "-"}
                </div>
              </div>
              <div>
                <div className="text-terminal-muted">Timestamp</div>
                <div className="text-terminal-text">{formatDate(selectedEventDetail.created_at)}</div>
              </div>
              {selectedEventDetail.ip_address && (
                <div>
                  <div className="text-terminal-muted">IP Address</div>
                  <div className="font-mono text-terminal-text">{selectedEventDetail.ip_address}</div>
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 text-terminal-muted">Full Payload</div>
              <pre className="max-h-64 overflow-auto rounded-sm border border-terminal-border bg-terminal-bg p-3 text-xs font-mono text-terminal-text">
                {JSON.stringify(selectedEventDetail.payload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </TerminalModal>
    </div>
  );
}