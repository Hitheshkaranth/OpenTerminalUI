import { api } from "./base";

export interface ChartWorkspace {
  id: string;
  name: string;
  layout_config: Record<string, unknown>;
  created_at: string;
}

export async function fetchChartWorkspaces(): Promise<ChartWorkspace[]> {
  const { data } = await api.get<{ templates: ChartWorkspace[] }>("chart-templates");
  return Array.isArray(data?.templates) ? data.templates : [];
}

export async function fetchChartWorkspace(templateId: string): Promise<ChartWorkspace> {
  const { data } = await api.get<ChartWorkspace>(`chart-templates/${encodeURIComponent(templateId)}`);
  return data;
}

export async function createChartWorkspace(name: string, layoutConfig: Record<string, unknown>): Promise<ChartWorkspace> {
  const { data } = await api.post<{ template: ChartWorkspace }>("chart-templates", { name, layout_config: layoutConfig });
  return data.template;
}

export async function updateChartWorkspace(
  templateId: string,
  name?: string,
  layoutConfig?: Record<string, unknown>,
): Promise<ChartWorkspace> {
  const payload: Record<string, unknown> = {};
  if (name !== undefined) payload.name = name;
  if (layoutConfig !== undefined) payload.layout_config = layoutConfig;
  const { data } = await api.patch<{ template: ChartWorkspace }>(
    `chart-templates/${encodeURIComponent(templateId)}`,
    payload,
  );
  return data.template;
}

export async function deleteChartWorkspace(templateId: string): Promise<void> {
  await api.delete(`chart-templates/${encodeURIComponent(templateId)}`);
}