import { useEffect, useMemo, useState } from "react";
import {
  BriefcaseIcon,
  BoltIcon,
  ChartBarIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  TableCellsIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import {
  BUILTIN_TEMPLATES,
  type WorkspaceTemplate,
  type WorkspaceTemplateCategory,
} from "../../data/workspaceTemplates";
import { TerminalButton, TerminalInput, TerminalModal } from "../terminal";

type TemplateGalleryProps = {
  open: boolean;
  onClose: () => void;
  activeTemplateId: string | null;
  templates: WorkspaceTemplate[];
  customTemplateIds: Set<string>;
  onApply: (template: WorkspaceTemplate) => void;
  onDeleteCustom: (id: string) => void;
  onSaveCurrent: (input: {
    name: string;
    description: string;
    category: WorkspaceTemplateCategory;
  }) => void;
};

type GalleryTab = "all" | WorkspaceTemplateCategory | "mine";

const TABS: Array<{ id: GalleryTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "trading", label: "Trading" },
  { id: "research", label: "Research" },
  { id: "portfolio", label: "Portfolio" },
  { id: "macro", label: "Macro" },
  { id: "mine", label: "My Templates" },
];

function TemplateIcon({ icon }: { icon: string }) {
  const className = "h-5 w-5";
  switch (icon) {
    case "bolt":
      return <BoltIcon className={className} />;
    case "chart-bar":
      return <ChartBarIcon className={className} />;
    case "table-cells":
      return <TableCellsIcon className={className} />;
    case "magnifying-glass":
      return <MagnifyingGlassIcon className={className} />;
    case "briefcase":
      return <BriefcaseIcon className={className} />;
    case "globe-alt":
      return <GlobeAltIcon className={className} />;
    default:
      return <Squares2X2Icon className={className} />;
  }
}

function TemplatePreview({ template }: { template: WorkspaceTemplate }) {
  const maxRows = Math.max(...template.panels.map((panel) => panel.grid.y + panel.grid.h), 10);

  return (
    <div className="relative h-28 overflow-hidden rounded-sm border border-terminal-border bg-[#06090F]">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(94,111,135,0.1)_1px,transparent_1px),linear-gradient(to_bottom,rgba(94,111,135,0.1)_1px,transparent_1px)] bg-[length:8.333%_10%]" />
      {template.panels.map((panel) => (
        <div
          key={panel.id}
          className="absolute rounded-[2px] border border-terminal-accent/40 bg-terminal-accent/15"
          style={{
            left: `${(panel.grid.x / 12) * 100}%`,
            top: `${(panel.grid.y / maxRows) * 100}%`,
            width: `${(panel.grid.w / 12) * 100}%`,
            height: `${(panel.grid.h / maxRows) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

export function TemplateGallery({
  open,
  onClose,
  activeTemplateId,
  templates,
  customTemplateIds,
  onApply,
  onDeleteCustom,
  onSaveCurrent,
}: TemplateGalleryProps) {
  const [tab, setTab] = useState<GalleryTab>("all");
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<WorkspaceTemplateCategory>("custom");

  useEffect(() => {
    if (!open) {
      setSaveOpen(false);
      setName("");
      setDescription("");
      setCategory("custom");
    }
  }, [open]);

  const builtinIds = useMemo(() => new Set(BUILTIN_TEMPLATES.map((template) => template.id)), []);

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const isCustom = customTemplateIds.has(template.id);
      if (tab === "mine") return isCustom;
      if (tab === "all") return true;
      return template.category === tab;
    });
  }, [customTemplateIds, tab, templates]);

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title="Workspace Templates"
      subtitle="Apply a saved Launchpad layout or capture the current grid as a reusable template."
      size="lg"
      className="max-w-6xl"
    >
      <div data-testid="workspace-template-gallery" className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map((item) => (
            <TerminalButton
              key={item.id}
              type="button"
              size="sm"
              variant={tab === item.id ? "accent" : "default"}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </TerminalButton>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredTemplates.map((template) => {
            const isCustom = customTemplateIds.has(template.id);
            const isBuiltin = builtinIds.has(template.id);
            return (
              <article
                key={template.id}
                data-testid={`workspace-template-card-${template.id}`}
                data-template-origin={isBuiltin ? "builtin" : "custom"}
                className={`group rounded-sm border bg-terminal-bg p-3 transition-colors ${
                  activeTemplateId === template.id
                    ? "border-terminal-accent shadow-[0_0_0_1px_rgba(255,140,0,0.2)]"
                    : "border-terminal-border hover:border-terminal-accent/50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="rounded-sm border border-terminal-border bg-terminal-panel p-2 text-terminal-accent">
                      <TemplateIcon icon={template.icon} />
                    </div>
                    <div className="min-w-0">
                      <div className="ot-type-panel-title truncate text-terminal-text">{template.name}</div>
                      <div className="text-[10px] uppercase tracking-[0.24em] text-terminal-muted">
                        {template.category}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-sm border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted">
                    {template.panels.length} panels
                  </div>
                </div>

                <p className="mt-3 min-h-10 text-xs leading-relaxed text-terminal-muted">
                  {template.description}
                </p>

                <div className="relative mt-3">
                  <TemplatePreview template={template} />
                  <div className="pointer-events-none absolute inset-0 rounded-sm bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="absolute bottom-2 right-2 rounded-sm border border-terminal-accent/50 bg-terminal-panel/90 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-terminal-accent">
                      Preview
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <TerminalButton
                    type="button"
                    size="sm"
                    variant="accent"
                    data-testid={`workspace-template-apply-${template.id}`}
                    onClick={() => onApply(template)}
                  >
                    Apply
                  </TerminalButton>
                  {isCustom ? (
                    <TerminalButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      data-testid={`workspace-template-delete-${template.id}`}
                      onClick={() => onDeleteCustom(template.id)}
                      leftIcon={<TrashIcon className="h-3.5 w-3.5" />}
                    >
                      Delete
                    </TerminalButton>
                  ) : (
                    <span className="text-[10px] text-terminal-muted">
                      {isBuiltin ? "Built in" : ""}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {!filteredTemplates.length ? (
          <div className="rounded-sm border border-dashed border-terminal-border bg-terminal-bg px-3 py-5 text-sm text-terminal-muted">
            No templates in this category yet.
          </div>
        ) : null}

        <div className="rounded-sm border border-terminal-border bg-terminal-bg p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="ot-type-panel-title text-terminal-accent">Save Current Layout</div>
              <div className="text-xs text-terminal-muted">
                Capture the current Launchpad grid as a reusable template in local storage.
              </div>
            </div>
            <TerminalButton
              type="button"
              variant="accent"
              size="sm"
              data-testid="workspace-template-save-current"
              onClick={() => setSaveOpen((value) => !value)}
            >
              {saveOpen ? "Hide Form" : "Save Current Layout"}
            </TerminalButton>
          </div>

          {saveOpen ? (
            <form
              className="mt-3 grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const nextName = name.trim();
                if (!nextName) return;
                onSaveCurrent({
                  name: nextName,
                  description: description.trim(),
                  category,
                });
                setSaveOpen(false);
                setName("");
                setDescription("");
                setCategory("custom");
                setTab("mine");
              }}
            >
              <label className="space-y-1 text-xs text-terminal-muted">
                <span>Name</span>
                <TerminalInput
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="My Layout"
                  data-testid="workspace-template-name-input"
                />
              </label>
              <label className="space-y-1 text-xs text-terminal-muted">
                <span>Category</span>
                <TerminalInput
                  as="select"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as WorkspaceTemplateCategory)}
                  data-testid="workspace-template-category-select"
                >
                  <option value="custom">Custom</option>
                  <option value="trading">Trading</option>
                  <option value="research">Research</option>
                  <option value="portfolio">Portfolio</option>
                  <option value="macro">Macro</option>
                </TerminalInput>
              </label>
              <label className="space-y-1 text-xs text-terminal-muted md:col-span-2">
                <span>Description</span>
                <TerminalInput
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Saved from the current Launchpad workspace"
                  data-testid="workspace-template-description-input"
                />
              </label>
              <div className="md:col-span-2">
                <TerminalButton
                  type="submit"
                  variant="accent"
                  size="sm"
                  disabled={!name.trim()}
                  data-testid="workspace-template-save-submit"
                >
                  Save Template
                </TerminalButton>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </TerminalModal>
  );
}
