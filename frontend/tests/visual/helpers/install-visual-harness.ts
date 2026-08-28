import type { Page } from "@playwright/test";
import {
  CREATE_DRAFT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  VISUAL_FROZEN_ISO,
} from "../constants";

const DISABLE_MOTION_CSS = `
*, *::before, *::after {
  animation: none !important;
  animation-duration: 0s !important;
  transition: none !important;
  caret-color: transparent !important;
}
html, body {
  font-family: Arial, Helvetica, sans-serif !important;
}
`;

export async function installVisualHarness(page: Page): Promise<void> {
  await page.addInitScript(
    ({ frozenIso, themeKey, draftKey, css }) => {
      const frozen = Date.parse(frozenIso);
      Date.now = () => frozen;

      class MockWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = MockWebSocket.CLOSED;
        url: string;
        protocol = "";
        extensions = "";
        binaryType: BinaryType = "blob";
        bufferedAmount = 0;
        onopen: ((ev: Event) => void) | null = null;
        onclose: ((ev: CloseEvent) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        onmessage: ((ev: MessageEvent) => void) | null = null;

        constructor(url: string | URL) {
          this.url = String(url);
        }

        send(): void {}
        close(): void {}
        addEventListener(): void {}
        removeEventListener(): void {}
        dispatchEvent(): boolean {
          return false;
        }
      }

      Object.defineProperty(window, "WebSocket", {
        configurable: true,
        writable: true,
        value: MockWebSocket,
      });

      window.localStorage.setItem(themeKey, "light");
      window.localStorage.removeItem(draftKey);
      document.documentElement.classList.remove("dark");

      const style = document.createElement("style");
      style.setAttribute("data-visual-harness", "true");
      style.textContent = css;
      document.documentElement.appendChild(style);

      if (navigator.serviceWorker?.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((registration) => {
            void registration.unregister();
          });
        });
      }
    },
    {
      frozenIso: VISUAL_FROZEN_ISO,
      themeKey: THEME_STORAGE_KEY,
      draftKey: CREATE_DRAFT_STORAGE_KEY,
      css: DISABLE_MOTION_CSS,
    },
  );
}
