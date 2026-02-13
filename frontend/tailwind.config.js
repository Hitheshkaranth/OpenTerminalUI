module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
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
