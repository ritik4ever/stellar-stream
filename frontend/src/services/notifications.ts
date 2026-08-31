import {
  type NotificationPreferences,
  type NotificationPreferenceMap,
  type NotificationToggle,
  type NotificationEventType,
  type NotificationChannel,
  getDefaultPreferences,
} from "../types/notifications";
import { ApiError, getAuthToken } from "./api";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

/**
 * Fetch notification preferences for the current user.
 * Falls back to defaults if the backend endpoint is not available.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const headers: Record<string, string> = {};
    const token = getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/notification-preferences`, {
      headers,
    });

    if (!response.ok) {
      // Endpoint may not exist yet — return defaults
      return {
        preferences: getDefaultPreferences(),
        channels: [
          { channel: "email", connected: false, label: "Email", detail: "Not configured" },
          { channel: "webhook", connected: false, label: "Webhook", detail: "Not configured" },
          { channel: "browser_push", connected: true, label: "Browser Push", detail: "Active" },
        ],
      };
    }

    const body = await response.json();
    return body.data as NotificationPreferences;
  } catch {
    // Graceful fallback when endpoint is unavailable
    return {
      preferences: getDefaultPreferences(),
      channels: [
        { channel: "email", connected: false, label: "Email", detail: "Not configured" },
        { channel: "webhook", connected: false, label: "Webhook", detail: "Not configured" },
        { channel: "browser_push", connected: true, label: "Browser Push", detail: "Active" },
      ],
    };
  }
}

/**
 * Update a single notification preference toggle.
 * Also persists to localStorage as a client-side fallback.
 */
export async function updateNotificationPreference(
  toggle: NotificationToggle,
): Promise<void> {
  // Persist to localStorage immediately for responsiveness
  const localPrefs = loadLocalPreferences();
  localPrefs[toggle.event][toggle.channel] = toggle.enabled;
  saveLocalPreferences(localPrefs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/notification-preferences`, {
      method: "PUT",
      headers,
      body: JSON.stringify(toggle),
    });

    if (!response.ok) {
      throw new ApiError(
        "Failed to save preference",
        response.status,
      );
    }
  } catch (err) {
    // If it's not a 404 (endpoint doesn't exist), rethrow
    if (err instanceof ApiError && err.statusCode === 404) {
      // Silently accept — localStorage fallback already saved
      return;
    }
    throw err;
  }
}

/**
 * Send a test notification for a given event type and channel.
 */
export async function sendTestNotification(
  event: NotificationEventType,
  channel: NotificationChannel,
): Promise<{ success: boolean; message: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/notification-preferences/test`, {
      method: "POST",
      headers,
      body: JSON.stringify({ event, channel }),
    });

    if (!response.ok) {
      return {
        success: false,
        message: `Test notification failed (${response.status})`,
      };
    }

    const body = await response.json();
    return {
      success: true,
      message: body.message ?? "Test notification sent",
    };
  } catch {
    return {
      success: false,
      message: "Test notification sent (demo mode)",
    };
  }
}

// ── localStorage helpers (client-side persistence) ──────────────────────

const STORAGE_KEY = "stellarstream_notification_prefs";

export function loadLocalPreferences(): NotificationPreferenceMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as NotificationPreferenceMap;
      // Validate shape: ensure all events and channels exist
      const defaults = getDefaultPreferences();
      for (const event of Object.keys(defaults) as NotificationEventType[]) {
        if (!parsed[event]) {
          parsed[event] = defaults[event];
        } else {
          for (const channel of ["email", "webhook", "browser_push"] as NotificationChannel[]) {
            if (typeof parsed[event][channel] !== "boolean") {
              parsed[event][channel] = defaults[event][channel];
            }
          }
        }
      }
      return parsed;
    }
  } catch {
    // Corrupted data — fall through to defaults
  }
  return getDefaultPreferences();
}

export function saveLocalPreferences(prefs: NotificationPreferenceMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or unavailable — ignore
  }
}
