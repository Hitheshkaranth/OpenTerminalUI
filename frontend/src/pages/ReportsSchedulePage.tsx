import { useState } from "react";
import { Bell, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createScheduledReport, deleteScheduledReport, fetchScheduledReports } from "../api/reports";
import type { ScheduledReport } from "../types";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

const REPORT_TYPES = [
  { value: "tearsheet", label: "Tearsheet" },
  { value: "market_status", label: "Market Status" },
  { value: "bulk_deals", label: "Bulk Deals" },
  { value: "block_deals", label: "Block Deals" },
];

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

type ReportFormData = {
  report_type: string;
  frequency: string;
  email: string;
};

export function ReportsSchedulePage() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<ReportFormData>({
    report_type: "tearsheet",
    frequency: "daily",
    email: "",
  });
  const [emailInput, setEmailInput] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const { data: reports = [], isLoading } = useQuery<ScheduledReport[]>({
    queryKey: ["scheduled-reports"],
    queryFn: fetchScheduledReports,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: ReportFormData) => createScheduledReport({ ...payload, data_type: "positions" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] });
      setActionMessage("Report scheduled successfully");
      setTimeout(() => setActionMessage(null), 3000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteScheduledReport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] });
      setActionMessage("Report deleted");
      setTimeout(() => setActionMessage(null), 3000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email.trim()) return;
    createMutation.mutate(formData);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleScheduleClick = () => {
    if (!emailInput.trim()) return;
    createMutation.mutate({ ...formData, email: emailInput.trim() });
  };

  const reportTypeLabel = REPORT_TYPES.find((t) => t.value === formData.report_type)?.label ?? "Tearsheet";
  const frequencyLabel = FREQUENCIES.find((f) => f.value === formData.frequency)?.label ?? "Daily";

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.06),transparent_30rem)] p-3 md:p-5">
      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
        <section className="rounded-md border border-terminal-border/70 bg-terminal-panel/95 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
          <h2 className="mb-4 font-sans text-lg font-semibold tracking-tight text-terminal-text">Scheduled Reports</h2>

          <form onSubmit={handleSubmit} className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] md:grid-cols-[160px_140px_1fr_auto]">
            <label className="block">
              <span className="mb-1 block font-sans text-xs text-terminal-muted">Report Type</span>
              <TerminalInput as="select" value={formData.report_type} onChange={(event) => setFormData((d) => ({ ...d, report_type: event.target.value }))} tone="ui">
                {REPORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </TerminalInput>
            </label>

            <label className="block">
              <span className="mb-1 block font-sans text-xs text-terminal-muted">Frequency</span>
              <TerminalInput as="select" value={formData.frequency} onChange={(event) => setFormData((d) => ({ ...d, frequency: event.target.value }))} tone="ui">
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </TerminalInput>
            </label>

            <label className="block sm:col-span-2 md:col-span-1">
              <span className="mb-1 block font-sans text-xs text-terminal-muted">Email</span>
              <TerminalInput
                tone="ui"
                value={formData.email}
                onChange={(event) => setFormData((d) => ({ ...d, email: event.target.value }))}
                type="email"
                placeholder="email@example.com"
              />
            </label>

            <button type="submit" disabled={createMutation.isPending} className="mt-auto">
              <TerminalButton variant="accent" loading={createMutation.isPending} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Schedule
              </TerminalButton>
            </button>
          </form>

          {actionMessage ? (
            <div className="mb-3 rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-xs text-terminal-text">
              {actionMessage}
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex h-20 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg">
              <div className="text-xs text-terminal-muted">Loading scheduled reports...</div>
            </div>
          ) : reports.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg">
              <div className="text-center">
                <Bell className="mx-auto mb-2 h-6 w-6 text-terminal-border" />
                <div className="text-sm text-terminal-muted">No scheduled reports</div>
                <div className="mt-1 text-xs text-terminal-muted">Add a report using the form above</div>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border bg-terminal-bg">
                    <th className="px-3 py-2 text-left font-sans font-medium text-terminal-muted">Report Type</th>
                    <th className="px-3 py-2 text-left font-sans font-medium text-terminal-muted">Frequency</th>
                    <th className="px-3 py-2 text-left font-sans font-medium text-terminal-muted">Email</th>
                    <th className="px-3 py-2 text-left font-sans font-medium text-terminal-muted">Data Type</th>
                    <th className="px-3 py-2 text-center font-sans font-medium text-terminal-muted">Status</th>
                    <th className="px-3 py-2 text-center font-sans font-medium text-terminal-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id} className="border-b border-terminal-border/40 hover:bg-terminal-bg/50">
                      <td className="px-3 py-2 font-sans text-terminal-text">
                        {REPORT_TYPES.find((t) => t.value === report.report_type)?.label ?? report.report_type}
                      </td>
                      <td className="px-3 py-2 font-sans text-terminal-muted">
                        {FREQUENCIES.find((f) => f.value === report.frequency)?.label ?? report.frequency}
                      </td>
                      <td className="px-3 py-2 font-sans text-terminal-text">{report.email}</td>
                      <td className="px-3 py-2 font-sans text-terminal-muted">{report.data_type || "positions"}</td>
                      <td className="px-3 py-2 text-center">
                        {report.enabled ? (
                          <span className="inline-block rounded-sm bg-terminal-pos/10 px-2 py-0.5 font-sans text-[10px] text-terminal-pos">Active</span>
                        ) : (
                          <span className="inline-block rounded-sm bg-terminal-border/40 px-2 py-0.5 font-sans text-[10px] text-terminal-muted">Paused</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleDelete(report.id)}
                          disabled={deleteMutation.isPending}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-terminal-border text-terminal-muted transition-colors hover:border-terminal-neg hover:bg-terminal-neg/10 hover:text-terminal-neg"
                          title="Delete schedule"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <TerminalPanel title="Quick Schedule" subtitle="Add a new report" bodyClassName="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[140px_1fr_auto]">
            <div>
              <span className="mb-1 block font-sans text-xs text-terminal-muted">Type</span>
              <div className="rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1.5 font-sans text-xs text-terminal-text">
                {reportTypeLabel}
              </div>
            </div>
            <div>
              <span className="mb-1 block font-sans text-xs text-terminal-muted">Email</span>
              <TerminalInput
                tone="ui"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                type="email"
                placeholder="recipient@example.com"
              />
            </div>
            <button type="button" onClick={handleScheduleClick} disabled={createMutation.isPending} className="mt-auto">
              <TerminalButton variant="accent" size="sm" loading={createMutation.isPending} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Quick Schedule
              </TerminalButton>
            </button>
          </div>
        </TerminalPanel>
      </main>
    </div>
  );
}