import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useShortcutStore } from "../store/shortcutStore";

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const { shortcuts } = useShortcutStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const isCtrl = event.ctrlKey || event.metaKey;
      const isAlt = event.altKey;
      const isShift = event.shiftKey;
      const key = event.key.toLowerCase();

      // Simple matching for single or ctrl+key
      for (const s of shortcuts) {
        const parts = s.keys.split("+").map(p => p.trim().toLowerCase());
        
        if (parts.length === 1 && parts[0] === key && !isCtrl && !isAlt) {
          executeAction(s.action);
          event.preventDefault();
          break;
        }
        
        if (parts.length === 2 && parts[0] === "ctrl" && parts[1] === key && isCtrl) {
          executeAction(s.action);
          event.preventDefault();
          break;
        }
      }
    };

    const executeAction = (action: string) => {
      if (action.startsWith("/")) {
        navigate(action);
      } else {
        // Dispatch custom event for app-wide actions
        window.dispatchEvent(new CustomEvent("otui-action", { detail: action }));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, navigate]);
}
