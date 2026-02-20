import { defineConfig, devices } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";
const useExistingServer = process.env.PLAYWRIGHT_USE_EXISTING_SERVER === "1";
const e2eBackendPort = Number(process.env.E2E_BACKEND_PORT || 8010);
const e2eFrontendPort = Number(process.env.E2E_FRONTEND_PORT || 4173);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: baseUrl,
    trace: "on-first-retry",
  },
  webServer: useExistingServer
    ? undefined
    : [
        {
          command: `python -m uvicorn backend.main:app --host 127.0.0.1 --port ${e2eBackendPort}`,
          port: e2eBackendPort,
          cwd: "..",
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: `npm run dev -- --host 127.0.0.1 --port ${e2eFrontendPort} --strictPort`,
          port: e2eFrontendPort,
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
