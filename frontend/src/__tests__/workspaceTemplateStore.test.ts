import { beforeEach, describe, expect, it } from "vitest";

import { BUILTIN_TEMPLATES } from "../data/workspaceTemplates";
import { useWorkspaceTemplateStore } from "../store/workspaceTemplateStore";

describe("workspaceTemplateStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceTemplateStore.setState({
      customTemplates: [],
      activeTemplateId: null,
    });
  });

  it("saves and deletes custom templates alongside builtins", () => {
    const templateId = useWorkspaceTemplateStore.getState().saveCustomTemplate({
      name: "My Layout",
      description: "Saved from tests",
      icon: "squares-2x2",
      category: "custom",
      gridCols: 2,
      panels: [
        {
          id: "panel-1",
          type: "chart",
          title: "Chart",
          props: {},
          grid: { x: 0, y: 0, w: 6, h: 6 },
        },
      ],
    });

    const afterSave = useWorkspaceTemplateStore.getState();
    expect(afterSave.customTemplates).toHaveLength(1);
    expect(afterSave.activeTemplateId).toBe(templateId);
    expect(afterSave.getAllTemplates()).toHaveLength(BUILTIN_TEMPLATES.length + 1);

    afterSave.deleteCustomTemplate(templateId);

    const afterDelete = useWorkspaceTemplateStore.getState();
    expect(afterDelete.customTemplates).toEqual([]);
    expect(afterDelete.activeTemplateId).toBeNull();
    expect(afterDelete.getAllTemplates()).toHaveLength(BUILTIN_TEMPLATES.length);
  });
});
