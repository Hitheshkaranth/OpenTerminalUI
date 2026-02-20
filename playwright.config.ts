import { defineConfig, devices } from "@playwright/test";

const E2E_FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 4173);
const E2E_BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8010);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${E2E_FRONTEND_PORT}`,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `python -m uvicorn backend.main:app --host 127.0.0.1 --port ${E2E_BACKEND_PORT}`,
      port: E2E_BACKEND_PORT,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `npm run dev --prefix frontend -- --host 127.0.0.1 --port ${E2E_FRONTEND_PORT} --strictPort`,
      port: E2E_FRONTEND_PORT,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
