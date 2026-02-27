import { useEffect } from "react";

import { useSettingsStore } from "../../store/settingsStore";

export function ThemeRuntime() {
  const themeVariant = useSettingsStore((s) => s.themeVariant);
  const customAccentColor = useSettingsStore((s) => s.customAccentColor);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-ot-theme", themeVariant);
    root.style.setProperty("--ot-custom-accent", customAccentColor);
    if (themeVariant === "light-desk") {
      root.style.setProperty("color-scheme", "light");
    } else {
      root.style.setProperty("color-scheme", "dark");
    }
  }, [themeVariant, customAccentColor]);

  return null;
}
