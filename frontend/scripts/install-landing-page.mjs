import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(scriptDir, "..");
const landingRoot = join(frontendRoot, "public", "landing");
const distRoot = join(frontendRoot, "dist");

function copyLandingFile(name) {
  copyFileSync(join(landingRoot, name), join(distRoot, name));
}

if (!existsSync(distRoot)) {
  throw new Error("Frontend dist directory does not exist. Run vite build first.");
}

copyLandingFile("index.html");
copyLandingFile("Docs.dc.html");
copyLandingFile("Features.dc.html");
copyLandingFile("Roadmap.dc.html");
copyLandingFile("support.js");

cpSync(join(landingRoot, "assets"), join(distRoot, "assets"), { recursive: true });

const landingScreenshots = join(landingRoot, "screenshots");
if (existsSync(landingScreenshots)) {
  mkdirSync(join(distRoot, "screenshots"), { recursive: true });
  cpSync(landingScreenshots, join(distRoot, "screenshots"), { recursive: true });
}
