import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

const DISMISS_KEY = "stellar-stream-install-prompt-dismissed";

function isIosDevice(): boolean {
  const userAgent = window.navigator.userAgent;
  const isClassicIos = /iPad|iPhone|iPod/.test(userAgent);
  const isIpadOs =
    window.navigator.platform === "MacIntel" &&
    window.navigator.maxTouchPoints > 1;

  return isClassicIos || isIpadOs;
}

function isMobileDevice(): boolean {
  return (
    isIosDevice() ||
    /Android|Mobile/i.test(window.navigator.userAgent)
  );
}

function isStandalone(): boolean {
  const navigatorWithStandalone =
    window.navigator as NavigatorWithStandalone;

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isMobileDevice() || isStandalone()) {
      return;
    }

    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "true") {
        setDismissed(true);
        return;
      }
    } catch {
      // Ignore storage access failures and continue showing the install option.
    }

    if (isIosDevice()) {
      setShowIosInstructions(true);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowIosInstructions(false);
      setDismissed(true);
    };

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt,
    );
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const dismissPrompt = () => {
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIosInstructions(false);

    try {
      sessionStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // Dismiss for the current render even if storage is unavailable.
    }
  };

  const installApp = async () => {
    if (!deferredPrompt) {
      return;
    }

    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setDismissed(true);
  };

  if (
    dismissed ||
    isStandalone() ||
    (!deferredPrompt && !showIosInstructions)
  ) {
    return null;
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label="Install StellarStream"
      style={{
        margin: "0 0 1rem",
        padding: "0.9rem 1rem",
        border: "1px solid var(--color-border)",
        borderRadius: "10px",
        background: "var(--color-background-secondary)",
        color: "var(--color-text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        flexWrap: "wrap",
      }}
    >
      <div>
        <strong>Install StellarStream</strong>
        <p
          style={{
            margin: "0.25rem 0 0",
            fontSize: "0.9rem",
            color: "var(--color-muted)",
          }}
        >
          {showIosInstructions
            ? "On iPhone or iPad, tap Share, then choose Add to Home Screen."
            : "Add StellarStream to your home screen for quick app-like access."}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        {deferredPrompt && (
          <button
            type="button"
            className="btn-ghost"
            onClick={installApp}
          >
            Install
          </button>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={dismissPrompt}
          aria-label="Dismiss install prompt"
        >
          {showIosInstructions ? "Got it" : "Not now"}
        </button>
      </div>
    </aside>
  );
}
