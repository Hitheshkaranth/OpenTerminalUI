module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    screens: {
      mobile: { max: "767px" },
      tablet: { min: "768px", max: "1279px" },
      desktop: { min: "1280px" },
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        terminal: {
          bg: "var(--ot-color-canvas)",
          panel: "var(--ot-color-surface-1)",
          border: "var(--ot-color-border-default)",
          text: "var(--ot-color-text-primary)",
          muted: "var(--ot-color-text-muted)",
          accent: "var(--ot-color-accent-primary)",
          pos: "var(--ot-color-market-up)",
          neg: "var(--ot-color-market-down)",
          warn: "var(--ot-color-system-warning)",
          black: "var(--ot-color-canvas)"
        }
      }
    }
  },
  plugins: []
};
