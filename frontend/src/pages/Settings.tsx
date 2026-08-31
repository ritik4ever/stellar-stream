import { useEffect, useState, useCallback } from "react";
import {
  ALL_CHANNELS,
  ALL_EVENT_TYPES,
  CHANNEL_LABELS,
  EVENT_LABELS,
  type NotificationChannel,
  type NotificationEventType,
  type NotificationPreferenceMap,
  type ChannelStatus,
} from "../types/notifications";
import {
  getNotificationPreferences,
  updateNotificationPreference,
  sendTestNotification,
} from "../services/notifications";
import { useToast } from "../hooks/useToast";

export function Settings() {
  const { showToast } = useToast();
  const [preferences, setPreferences] = useState<NotificationPreferenceMap | null>(null);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getNotificationPreferences();
      setPreferences(result.preferences);
      setChannels(result.channels);
    } catch (err) {
      showToast("Failed to load notification preferences", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  async function handleToggle(
    event: NotificationEventType,
    channel: NotificationChannel,
  ): Promise<void> {
    if (!preferences) return;

    const toggleKey = `${event}-${channel}`;
    const newValue = !preferences[event][channel];

    // Optimistic update
    setPreferences((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [event]: {
          ...prev[event],
          [channel]: newValue,
        },
      };
    });

    setSaving((prev) => ({ ...prev, [toggleKey]: true }));

    try {
      await updateNotificationPreference({ event, channel, enabled: newValue });
    } catch {
      // Revert on failure
      setPreferences((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [event]: {
            ...prev[event],
            [channel]: !newValue,
          },
        };
      });
      showToast(`Failed to update ${EVENT_LABELS[event]} / ${CHANNEL_LABELS[channel]}`, "error");
    } finally {
      setSaving((prev) => ({ ...prev, [toggleKey]: false }));
    }
  }

  async function handlePreview(
    event: NotificationEventType,
    channel: NotificationChannel,
  ): Promise<void> {
    const key = `${event}-${channel}`;
    setPreviewLoading(key);
    try {
      const result = await sendTestNotification(event, channel);
      if (result.success) {
        showToast(result.message, "success");
      } else {
        showToast(result.message, "error");
      }
    } catch {
      showToast("Failed to send test notification", "error");
    } finally {
      setPreviewLoading(null);
    }
  }

  if (loading || !preferences) {
    return (
      <div className="settings-page">
        <div className="app-shell">Loading settings…</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="app-shell">
        <h2 className="settings-title">Settings</h2>

        {/* ── Channel Status ─────────────────────────────── */}
        <section className="card settings-section">
          <h3 className="settings-section__title">Notification Channels</h3>
          <p className="settings-section__desc">
            Status of each notification channel. Configure your email and webhook settings to enable those channels.
          </p>
          <div className="channel-status-grid">
            {channels.map((ch) => (
              <div key={ch.channel} className="channel-status-card">
                <div className="channel-status-card__header">
                  <span className={`channel-dot ${ch.connected ? "channel-dot--active" : "channel-dot--inactive"}`} />
                  <strong>{ch.label}</strong>
                </div>
                <span className="muted">
                  {ch.connected ? ch.detail ?? "Connected" : ch.detail ?? "Not connected"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Notification Preferences Grid ───────────────── */}
        <section className="card settings-section">
          <h3 className="settings-section__title">Notification Preferences</h3>
          <p className="settings-section__desc">
            Choose which stream events send notifications and through which channels.
          </p>

          <div className="pref-table-wrap">
            <table className="pref-table">
              <thead>
                <tr>
                  <th className="pref-table__event-col">Event</th>
                  {ALL_CHANNELS.map((ch) => (
                    <th key={ch} className="pref-table__channel-col">
                      {CHANNEL_LABELS[ch]}
                    </th>
                  ))}
                  <th className="pref-table__preview-col">Preview</th>
                </tr>
              </thead>
              <tbody>
                {ALL_EVENT_TYPES.map((event) => (
                  <tr key={event}>
                    <td className="pref-table__event-label">
                      <span className="pref-event-icon">{getEventIcon(event)}</span>
                      {EVENT_LABELS[event]}
                    </td>
                    {ALL_CHANNELS.map((ch) => {
                      const toggleKey = `${event}-${ch}`;
                      const isSaving = saving[toggleKey] ?? false;
                      return (
                        <td key={ch} className="pref-table__toggle-cell">
                          <label className="toggle-switch" htmlFor={toggleKey}>
                            <input
                              id={toggleKey}
                              type="checkbox"
                              checked={preferences[event][ch]}
                              disabled={isSaving}
                              onChange={() => void handleToggle(event, ch)}
                            />
                            <span className="toggle-switch__slider" />
                          </label>
                        </td>
                      );
                    })}
                    <td className="pref-table__preview-cell">
                      <div className="preview-btn-group">
                        {ALL_CHANNELS.map((ch) => {
                          const previewKey = `${event}-${ch}`;
                          const isLoading = previewLoading === previewKey;
                          return (
                            <button
                              key={ch}
                              type="button"
                              className="btn-ghost btn-preview"
                              disabled={isLoading || !preferences[event][ch]}
                              title={`Send test ${EVENT_LABELS[event]} via ${CHANNEL_LABELS[ch]}`}
                              onClick={() => void handlePreview(event, ch)}
                            >
                              {isLoading ? "…" : getChannelIcon(ch)}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function getEventIcon(event: NotificationEventType): string {
  switch (event) {
    case "created":
      return "＋";
    case "claimed":
      return "✓";
    case "canceled":
      return "✕";
    case "paused":
      return "⏸";
    case "resumed":
      return "▶";
    case "completed":
      return "🏆";
    default:
      return "●";
  }
}

function getChannelIcon(channel: NotificationChannel): string {
  switch (channel) {
    case "email":
      return "✉";
    case "webhook":
      return "🔗";
    case "browser_push":
      return "🔔";
    default:
      return "●";
  }
}
