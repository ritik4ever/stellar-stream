export const VISUAL_VIEWPORT = {
  width: 1280,
  height: 800,
} as const;

export const VISUAL_FROZEN_ISO = "2026-08-15T12:00:00.000Z";

export const VISUAL_FROZEN_MS = Date.parse(VISUAL_FROZEN_ISO);

export const VISUAL_FROZEN_UNIX = Math.floor(VISUAL_FROZEN_MS / 1000);

export const VISUAL_BASE_URL = "http://127.0.0.1:4173";

export const VISUAL_PREVIEW_PORT = 4173;

export enum VisualScene {
  Dashboard = "dashboard",
  StreamDetail = "stream-detail",
  CreateForm = "create-form",
  Timeline = "timeline",
}

export enum VisualTestId {
  Dashboard = "visual-dashboard",
  CreateForm = "visual-create-form",
  Timeline = "visual-timeline",
  StreamDetail = "visual-stream-detail",
}

export enum ApiRouteKind {
  Config = "config",
  StreamsList = "streams-list",
  StreamDetail = "stream-detail",
  StreamHistory = "stream-history",
  Events = "events",
  OpenIssues = "open-issues",
  MetricsHistory = "metrics-history",
  Stats = "stats",
}

export const API_PATH = {
  [ApiRouteKind.Config]: "/api/config",
  [ApiRouteKind.StreamsList]: "/api/streams",
  [ApiRouteKind.Events]: "/api/events",
  [ApiRouteKind.OpenIssues]: "/api/open-issues",
  [ApiRouteKind.MetricsHistory]: "/api/metrics/history",
  [ApiRouteKind.Stats]: "/api/stats",
} as const;

export const STREAM_HISTORY_PATH_PATTERN =
  /^\/api\/streams\/([^/]+)\/history\/?$/;

export const STREAM_DETAIL_PATH_PATTERN = /^\/api\/streams\/([^/]+)\/?$/;

export const THEME_STORAGE_KEY = "stellar-stream-theme";

export const CREATE_DRAFT_STORAGE_KEY = "stellar-stream:create-draft";

export const VISUAL_APPROVE_LABEL = "approve-visual-baselines";

export const SCREENSHOT_OPTIONS = {
  animations: "disabled" as const,
  caret: "hide" as const,
  scale: "css" as const,
};
