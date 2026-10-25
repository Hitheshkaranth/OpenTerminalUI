import { useEffect } from "react";

import { useSettingsStore } from "../../store/settingsStore";

export function ThemeRuntime() {
  const themeVariant = useSettingsStore((s) => s.themeVariant);
  const customAccentColor = useSettingsStore((s) => s.customAccentColor);

  const density = useSettingsStore((s) => s.density);
  const textScale = useSettingsStore((s) => s.textScale);
  const terminalEffects = useSettingsStore((s) => s.terminalEffects);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-ot-theme", themeVariant);
    root.setAttribute("data-ot-density", density);
    root.setAttribute("data-ot-effects", String(terminalEffects));
    root.style.fontSize = `${16 * textScale}px`;
    for (const [size, pixels] of Object.entries({ "2xs": 10, xs: 11, sm: 12, md: 13, lg: 14, xl: 16, "2xl": 18 })) root.style.setProperty(`--ot-type-size-${size}`, `${pixels * textScale}px`);
    root.style.setProperty("--ot-custom-accent", customAccentColor);
    if (themeVariant === "light-desk") {
      root.style.setProperty("color-scheme", "light");
    } else {
      root.style.setProperty("color-scheme", "dark");
    }
  }, [themeVariant, customAccentColor, density, textScale, terminalEffects]);

  return null;
}
