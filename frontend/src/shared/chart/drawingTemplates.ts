import {
  updateDrawingStyle,
  type DrawingStyle,
  type DrawingToolFamily,
  type DrawingToolType,
  type NormalizedChartDrawing,
} from "./drawingEngine";

export const DRAWING_TEMPLATE_SCHEMA_VERSION = 1;
export const DRAWING_TEMPLATE_STORAGE_KEY = "lts:drawing-style-templates:v1";

export type DrawingTemplateRecord = {
  version: typeof DRAWING_TEMPLATE_SCHEMA_VERSION;
  id: string;
  name: string;
  toolType: DrawingToolType;
  family: DrawingToolFamily;
  style: DrawingStyle;
  favorite: boolean;
  createdAt: string;
};

function normalizeTemplateId(input: unknown, fallback: string): string {
  return typeof input === "string" && input.trim() ? input.trim() : fallback;
}

function normalizeTemplateName(input: unknown, fallback: string): string {
  return typeof input === "string" && input.trim() ? input.trim() : fallback;
}

function normalizeFavorite(input: unknown): boolean {
  return input === true;
}

function normalizeTemplate(input: unknown): DrawingTemplateRecord | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<DrawingTemplateRecord> & Record<string, unknown>;
  const toolType = raw.toolType;
  const family = raw.family;
  if (
    toolType !== "trendline" &&
    toolType !== "ray" &&
    toolType !== "hline" &&
    toolType !== "vline" &&
    toolType !== "rectangle"
  ) {
    return null;
  }
  if (family !== "line" && family !== "level" && family !== "marker" && family !== "range") {
    return null;
  }
  if (!raw.style || typeof raw.style !== "object") return null;

  const style = raw.style as DrawingStyle;
  if (
    typeof style.color !== "string" ||
    typeof style.lineWidth !== "number" ||
    (style.lineStyle !== "solid" && style.lineStyle !== "dashed")
  ) {
    return null;
  }

  return {
    version: DRAWING_TEMPLATE_SCHEMA_VERSION,
    id: normalizeTemplateId(raw.id, `tpl-${toolType}-${Date.now()}`),
    name: normalizeTemplateName(raw.name, `${toolType} template`),
    toolType,
    family,
    style: {
      color: style.color,
      lineWidth: style.lineWidth,
      lineStyle: style.lineStyle,
      fillColor: typeof style.fillColor === "string" ? style.fillColor : null,
      fillOpacity: typeof style.fillOpacity === "number" ? style.fillOpacity : 0,
    },
    favorite: normalizeFavorite(raw.favorite),
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt.trim()
        ? raw.createdAt
        : new Date(0).toISOString(),
  };
}

export function normalizeStoredDrawingTemplates(input: unknown): DrawingTemplateRecord[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: DrawingTemplateRecord[] = [];
  for (const item of input) {
    const template = normalizeTemplate(item);
    if (!template || seen.has(template.id)) continue;
    seen.add(template.id);
    out.push(template);
  }
  return out.sort((left, right) => {
    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function createDrawingTemplateFromDrawing(
  drawing: NormalizedChartDrawing,
  name?: string,
): DrawingTemplateRecord {
  return {
    version: DRAWING_TEMPLATE_SCHEMA_VERSION,
    id: `tpl-${drawing.tool.type}-${Date.now()}`,
    name: normalizeTemplateName(name, `${drawing.tool.label} Template`),
    toolType: drawing.tool.type,
    family: drawing.tool.family,
    style: { ...drawing.style },
    favorite: false,
    createdAt: new Date().toISOString(),
  };
}

export function upsertDrawingTemplate(
  templates: DrawingTemplateRecord[],
  template: DrawingTemplateRecord,
): DrawingTemplateRecord[] {
  const existing = templates.filter((item) => item.id !== template.id);
  return normalizeStoredDrawingTemplates([template, ...existing]);
}

export function deleteDrawingTemplate(
  templates: DrawingTemplateRecord[],
  templateId: string,
): DrawingTemplateRecord[] {
  return normalizeStoredDrawingTemplates(templates.filter((item) => item.id !== templateId));
}

export function toggleDrawingTemplateFavorite(
  templates: DrawingTemplateRecord[],
  templateId: string,
): DrawingTemplateRecord[] {
  return normalizeStoredDrawingTemplates(
    templates.map((item) =>
      item.id === templateId
        ? {
            ...item,
            favorite: !item.favorite,
          }
        : item,
    ),
  );
}

export function templatesForDrawingTool(
  templates: DrawingTemplateRecord[],
  toolType: DrawingToolType | null,
  family?: DrawingToolFamily | null,
): DrawingTemplateRecord[] {
  if (!toolType && !family) return normalizeStoredDrawingTemplates(templates);
  return normalizeStoredDrawingTemplates(
    templates.filter((item) => item.toolType === toolType || (family ? item.family === family : false)),
  );
}

export function resolvePreferredTemplate(
  templates: DrawingTemplateRecord[],
  toolType: DrawingToolType,
  family: DrawingToolFamily,
): DrawingTemplateRecord | null {
  const scoped = templatesForDrawingTool(templates, toolType, family);
  return scoped.find((item) => item.favorite && item.toolType === toolType)
    ?? scoped.find((item) => item.favorite && item.family === family)
    ?? scoped[0]
    ?? null;
}

export function applyDrawingTemplate(
  drawing: NormalizedChartDrawing,
  template: DrawingTemplateRecord,
): NormalizedChartDrawing {
  return updateDrawingStyle(drawing, template.style);
}
