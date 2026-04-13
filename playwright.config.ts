const path = require("node:path");
const fs = require("node:fs");
const { defineConfig, devices } = require("./frontend/node_modules/@playwright/test");

const E2E_FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 4173);
const E2E_BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8010);

let ROOT_DIR = process.cwd();
if (!fs.existsSync(path.join(ROOT_DIR, "data")) && fs.existsSync(path.join(ROOT_DIR, "..", "data"))) {
  ROOT_DIR = path.resolve(ROOT_DIR, "..");
}
console.log("DEBUG: ROOT_DIR =", ROOT_DIR);

const SQLITE_PATH = path.join(ROOT_DIR, "data", "playwright-e2e.db").replace(/\\/g, "/");
const SQLITE_URL = `sqlite:///${SQLITE_PATH}`;
const DATABASE_URL = SQLITE_URL.replace("sqlite:///", "sqlite+aiosqlite:///");
const AUTH_STATE_PATH = process.env.PLAYWRIGHT_AUTH_STATE_PATH || path.join(ROOT_DIR, "playwright", ".auth", "user.json");
console.log("DEBUG: SQLITE_URL =", SQLITE_URL);
console.log("DEBUG: DATABASE_URL =", DATABASE_URL);

export default defineConfig({
  testDir: path.join(ROOT_DIR, "frontend", "tests", "e2e"),
  timeout: 60_000,
  workers: 2,
  fullyParallel: false,
  globalSetup: path.join(ROOT_DIR, "frontend", "tests", "e2e", "global-setup.ts"),
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${E2E_FRONTEND_PORT}`,
    trace: "on-first-retry",
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    storageState: AUTH_STATE_PATH,
  },
  webServer: [
    {
      command: `python -m uvicorn backend.main:app --host 127.0.0.1 --port ${E2E_BACKEND_PORT}`,
      cwd: ROOT_DIR,
      port: E2E_BACKEND_PORT,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...process.env,
        AUTH_MIDDLEWARE_ENABLED: "0",
        OPENTERMINALUI_CORS_ORIGINS: `http://127.0.0.1:${E2E_FRONTEND_PORT},http://localhost:${E2E_FRONTEND_PORT}`,
        OPENTERMINALUI_SQLITE_URL: SQLITE_URL,
        DATABASE_URL,
      },
    },
    {
      command: `npm --prefix frontend run build && npm --prefix frontend run preview -- --host 127.0.0.1 --port ${E2E_FRONTEND_PORT} --strictPort`,
      cwd: ROOT_DIR,
      port: E2E_FRONTEND_PORT,
      reuseExistingServer: true,
      timeout: 240_000,
      env: {
        ...process.env,
        VITE_API_BASE_URL: `http://127.0.0.1:${E2E_BACKEND_PORT}/api`,
        VITE_PROXY_TARGET: `http://127.0.0.1:${E2E_BACKEND_PORT}`,
        VITE_E2E_AUTO_LOGIN: "1",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
