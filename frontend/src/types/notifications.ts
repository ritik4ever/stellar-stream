/** Stream event types that can trigger notifications */
export type NotificationEventType =
  | "created"
  | "claimed"
  | "canceled"
  | "paused"
  | "resumed"
  | "completed";

/** Delivery channels for notifications */
export type NotificationChannel = "email" | "webhook" | "browser_push";

/** Map of event types to enabled channels */
export type NotificationPreferenceMap = Record<NotificationEventType, Record<NotificationChannel, boolean>>;

/** Channel connectivity status */
export interface ChannelStatus {
  channel: NotificationChannel;
  connected: boolean;
  label: string;
  detail?: string;
}

/** A single notification preference toggle */
export interface NotificationToggle {
  event: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
}

/** Full notification preferences response from backend */
export interface NotificationPreferences {
  preferences: NotificationPreferenceMap;
  channels: ChannelStatus[];
}

/** Default event labels for display */
export const EVENT_LABELS: Record<NotificationEventType, string> = {
  created: "Stream Created",
  claimed: "Stream Claimed",
  canceled: "Stream Canceled",
  paused: "Stream Paused",
  resumed: "Stream Resumed",
  completed: "Stream Completed",
};

/** Default channel labels for display */
export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: "Email",
  webhook: "Webhook",
  browser_push: "Browser Push",
};

/** All event types (for iteration) */
export const ALL_EVENT_TYPES: NotificationEventType[] = [
  "created",
  "claimed",
  "canceled",
  "paused",
  "resumed",
  "completed",
];

/** All channels (for iteration) */
export const ALL_CHANNELS: NotificationChannel[] = [
  "email",
  "webhook",
  "browser_push",
];

/** Default preferences (all channels enabled for all events) */
export function getDefaultPreferences(): NotificationPreferenceMap {
  const prefs: NotificationPreferenceMap = {} as NotificationPreferenceMap;
  for (const event of ALL_EVENT_TYPES) {
    prefs[event] = {} as Record<NotificationChannel, boolean>;
    for (const channel of ALL_CHANNELS) {
      prefs[event][channel] = true;
    }
  }
  return prefs;
}
