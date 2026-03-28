import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const CHUNK_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;

function isRetryableChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to fetch dynamically imported module") ||
    normalized.includes("importing a module script failed") ||
    normalized.includes("loading chunk") ||
    normalized.includes("chunkloaderror") ||
    normalized.includes("dynamically imported module")
  );
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

async function importWithRetry<T>(
  loader: () => Promise<{ default: T }>,
  attempt = 0,
): Promise<{ default: T }> {
  try {
    return await loader();
  } catch (error) {
    if (!isRetryableChunkError(error) || attempt >= CHUNK_RETRY_ATTEMPTS) {
      throw error;
    }
    await wait(RETRY_DELAY_MS * (attempt + 1));
    return importWithRetry(loader, attempt + 1);
  }
}

export function lazyWithRetry<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(loader));
}
