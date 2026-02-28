import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

type KeyboardNavigationContextType = {
  focusedPanelId: string | null;
  setFocusedPanelId: (id: string | null) => void;
  registerPanel: (id: string) => void;
  unregisterPanel: (id: string) => void;
};

const KeyboardNavigationContext = createContext<KeyboardNavigationContextType | undefined>(undefined);

export function KeyboardNavigationProvider({ children }: { children: React.ReactNode }) {
  const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);
  const [panels, setPanels] = useState<string[]>([]);
  const navigate = useNavigate();

  const registerPanel = useCallback((id: string) => {
    setPanels((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const unregisterPanel = useCallback((id: string) => {
    setPanels((prev) => prev.filter((p) => p !== id));
    setFocusedPanelId((prev) => (prev === id ? null : prev));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global shortcuts
      if (e.ctrlKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        // Command bar focus handled separately or trigger event
        window.dispatchEvent(new CustomEvent("focus-command-bar"));
      } else if (e.ctrlKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        navigate("/equity/watchlist");
      } else if (e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        navigate("/equity/news");
      } else if (e.ctrlKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        navigate("/equity/portfolio");
      } else if (e.ctrlKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        navigate("/backtesting");
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (panels.length > 0) {
          const currentIndex = focusedPanelId ? panels.indexOf(focusedPanelId) : -1;
          const nextIndex = (currentIndex + 1) % panels.length;
          setFocusedPanelId(panels[nextIndex]);
        }
      } else if (e.key === "Escape") {
        // Blur or close modals
        (document.activeElement as HTMLElement)?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, panels, focusedPanelId]);

  return (
    <KeyboardNavigationContext.Provider value={{ focusedPanelId, setFocusedPanelId, registerPanel, unregisterPanel }}>
      {children}
    </KeyboardNavigationContext.Provider>
  );
}

export function useKeyboardNavigation() {
  const context = useContext(KeyboardNavigationContext);
  if (!context) throw new Error("useKeyboardNavigation must be used within KeyboardNavigationProvider");
  return context;
}
