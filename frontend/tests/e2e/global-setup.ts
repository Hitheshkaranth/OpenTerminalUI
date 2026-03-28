import { chromium, type FullConfig } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

export default async function globalSetup(config: FullConfig) {
  const firstProjectBaseUrl = config.projects[0]?.use?.baseURL;
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  const accessToken = makeJwt({
    sub: "e2e-user",
    email: "e2e@example.com",
    role: "trader",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const refreshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.addInitScript(
      ([at, rt]) => {
        localStorage.setItem("ot-access-token", at);
        localStorage.setItem("ot-refresh-token", rt);
      },
      [accessToken, refreshToken],
    );

    if (typeof firstProjectBaseUrl === "string") {
      await page.goto(firstProjectBaseUrl, { waitUntil: "domcontentloaded" });
    }
  } finally {
    await context.close();
    await browser.close();
  }
}
