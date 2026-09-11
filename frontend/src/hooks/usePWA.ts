import { useEffect, useRef, useState } from "react";

export type UsePWAMountedPrompt = {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type UsePWAState = {
  isInstalled: boolean;
  isReady: boolean;
  showInstallPrompt: boolean;
  installPrompt: UsePWAMountedPrompt | null;
  dismissInstallPrompt: () => void;
};

function useSWRegistration() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setIsReady(true);
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (registration.active) {
          setIsReady(true);
          return;
        }
        if (registration.installing) {
          registration.installing.addEventListener("statechange", () => {
            if ((registration.installing as any).state === "activated") {
              setIsReady(true);
            }
          });
        }
      })
      .catch(() => {
        setIsReady(true);
      });
  }, []);

  return isReady;
}

export function usePWA(): UsePWAState {
  const isReady = useSWRegistration();
  const promptStateRef = useRef<{
    promptFn: () => void;
    dismissFn: () => void;
  } | null>(null);
  const [, forceRender] = useState(0);
  const [isInstalled, setIsInstalled] = useState(false);

  const triggerRender = () => forceRender((n) => n + 1);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      const promptEvt = e as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
      promptStateRef.current = {
        promptFn: () => {
          promptEvt.prompt();
          promptEvt.userChoice.then((choice) => {
            if (choice.outcome === "accepted") {
              setIsInstalled(true);
            }
            promptStateRef.current = null;
            triggerRender();
          });
        },
        dismissFn: () => {
          promptStateRef.current = null;
          triggerRender();
        },
      };
      triggerRender();
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const checkStandalone = () => setIsInstalled(mediaQuery.matches);
    checkStandalone();
    const listener = () => checkStandalone();
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  const promptRef = promptStateRef.current;

  const installPrompt: UsePWAMountedPrompt | null = promptRef
    ? { prompt: promptRef.promptFn, userChoice: Promise.resolve({ outcome: "dismissed" }) }
    : null;

  return {
    isInstalled,
    isReady,
    showInstallPrompt: !isInstalled && !!promptRef,
    installPrompt,
    dismissInstallPrompt: promptRef?.dismissFn ?? (() => {}),
  };
}