import { defineConfig, devices } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";
const useExistingServer = process.env.PLAYWRIGHT_USE_EXISTING_SERVER === "1";
const e2eBackendPort = Number(process.env.E2E_BACKEND_PORT || 8010);
const e2eFrontendPort = Number(process.env.E2E_FRONTEND_PORT || 4173);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 2,
  fullyParallel: false,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: baseUrl,
    trace: "on-first-retry",
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
  },
  webServer: useExistingServer
    ? undefined
    : [
        {
          command: `python -m uvicorn backend.main:app --host 127.0.0.1 --port ${e2eBackendPort}`,
          url: `http://127.0.0.1:${e2eBackendPort}/health`,
          cwd: "..",
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            OPENTERMINALUI_SQLITE_URL: "sqlite:///./e2e_test.db",
          },
        },
        {
          command: `${npmCommand} run dev -- --host 127.0.0.1 --port ${e2eFrontendPort} --strictPort`,
          url: `http://127.0.0.1:${e2eFrontendPort}/login`,
          cwd: ".",
          env: {
            VITE_API_BASE_URL: `http://127.0.0.1:${e2eBackendPort}/api`,
            VITE_PROXY_TARGET: `http://127.0.0.1:${e2eBackendPort}`,
          },
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
