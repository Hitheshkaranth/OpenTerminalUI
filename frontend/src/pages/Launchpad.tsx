import { useMemo, useState } from "react";
import { RectangleStackIcon } from "@heroicons/react/24/outline";

import { LaunchpadProvider } from "../components/layout/LaunchpadContext";
import { LaunchpadWorkspace } from "../components/layout/LaunchpadWorkspace";
import {
  isLaunchpadPanelType,
  type LaunchpadPanelConfig,
  type LaunchpadPanelType,
} from "../components/layout/LaunchpadContext";
import { TemplateGallery } from "../components/layout/TemplateGallery";
import { TerminalButton } from "../components/terminal";
import { inferTemplateGridCols, type WorkspaceTemplate } from "../data/workspaceTemplates";
import { useWorkspaceTemplateStore } from "../store/workspaceTemplateStore";
import { useLaunchpad } from "../components/layout/LaunchpadContext";

function makePanelId(templateId: string, panelId: string) {
  return `${templateId}-${panelId}-${Math.random().toString(36).slice(2, 8)}`;
}

function materializeTemplatePanels(template: WorkspaceTemplate): LaunchpadPanelConfig[] {
  return template.panels.map((panel) => ({
    id: makePanelId(template.id, panel.id),
    type: isLaunchpadPanelType(panel.type) ? panel.type : ("chart" as LaunchpadPanelType),
    title: panel.title,
    props: panel.props,
    x: panel.grid.x,
    y: panel.grid.y,
    w: panel.grid.w,
    h: panel.grid.h,
    linked: true,
    linkGroup: "red",
    poppedOut: false,
  }));
}

function LaunchpadScreen() {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const {
    activeLayout,
    replacePanels,
  } = useLaunchpad();
  const {
    customTemplates,
    activeTemplateId,
    deleteCustomTemplate,
    getAllTemplates,
    saveCustomTemplate,
    setActiveTemplateId,
  } = useWorkspaceTemplateStore();

  const templates = useMemo(() => getAllTemplates(), [customTemplates, getAllTemplates]);
  const customTemplateIds = useMemo(() => new Set(customTemplates.map((template) => template.id)), [customTemplates]);

  return (
    <>
      <div className="h-full min-h-0">
        <LaunchpadWorkspace
          toolbarActions={
            <TerminalButton
              type="button"
              size="sm"
              variant="default"
              leftIcon={<RectangleStackIcon className="h-4 w-4" />}
              onClick={() => setGalleryOpen(true)}
            >
              Templates
            </TerminalButton>
          }
        />
      </div>
      <TemplateGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        activeTemplateId={activeTemplateId}
        templates={templates}
        customTemplateIds={customTemplateIds}
        onApply={(template) => {
          replacePanels(materializeTemplatePanels(template));
          setActiveTemplateId(template.id);
          setGalleryOpen(false);
        }}
        onDeleteCustom={deleteCustomTemplate}
        onSaveCurrent={({ name, description, category }) => {
          if (!activeLayout) return;
          const id = saveCustomTemplate({
            name,
            description,
            icon: "squares-2x2",
            category,
            gridCols: inferTemplateGridCols(activeLayout.panels),
            panels: activeLayout.panels.map((panel) => ({
              id: panel.id,
              type: panel.type,
              title: panel.title,
              props: panel.props ?? {},
              grid: { x: panel.x, y: panel.y, w: panel.w, h: panel.h },
            })),
          });
          setActiveTemplateId(id);
        }}
      />
    </>
  );
}

export function LaunchpadPage() {
  return (
    <LaunchpadProvider>
      <LaunchpadScreen />
    </LaunchpadProvider>
  );
}
