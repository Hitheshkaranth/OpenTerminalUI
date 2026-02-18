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
          bg: "#06080c",
          panel: "#0c0f14",
          border: "#2a2f3a",
          text: "#d8dde7",
          muted: "#8e98a8",
          accent: "#ff9f1a",
          pos: "#00c176",
          neg: "#ff4d4f",
          warn: "#ffb74d"
        }
      }
    }
  },
  plugins: []
};
