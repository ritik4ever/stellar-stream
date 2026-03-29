/**
 * streamHealthBadges.ts
 *
 * Pure utility that derives contextual health badges from a stream's
 * current state. All thresholds are named constants so badge logic stays
 * deterministic and easy to audit.
 *
 * Badges are ADDITIVE — they never replace the core status label.
 */

import { Stream } from "../types/stream";

// ── Thresholds ────────────────────────────────────────────────────────────

/** Max seconds before start for "Starts Soon" to appear (1 hour). */
export const STARTS_SOON_THRESHOLD_S = 60 * 60;

/** Min percent complete (exclusive) before "Claim Pending" applies. */
export const CLAIM_PENDING_MIN_PCT = 10;

/** Min percent complete for "Almost Done" to appear. */
export const ALMOST_DONE_PCT = 90;

/** Max remaining seconds for "Expiring Soon" to appear (15 minutes). */
export const EXPIRING_SOON_THRESHOLD_S = 15 * 60;

/** Max seconds since cancelation for "Recently Canceled" to appear (24 h). */
export const RECENTLY_CANCELED_THRESHOLD_S = 24 * 60 * 60;

// ── Types ─────────────────────────────────────────────────────────────────

export interface HealthBadge {
  /** Stable key, safe to use as React key. */
  key: string;
  /** Short human-readable label shown inside the badge. */
  label: string;
  /** CSS modifier class applied to the badge element. */
  cssClass: string;
  /** Longer tooltip text for screen-readers / title attribute. */
  title: string;
}

// ── Main function ─────────────────────────────────────────────────────────

/**
 * Returns zero or more health badges for a stream.
 *
 * @param stream     The stream to evaluate.
 * @param nowSeconds Current unix time in seconds (injectable for testing).
 */
export function getHealthBadges(
  stream: Stream,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): HealthBadge[] {
  const badges: HealthBadge[] = [];
  const { status, percentComplete, remainingAmount, ratePerSecond } =
    stream.progress;

  // ── scheduled ────────────────────────────────────────────────────────
  if (status === "scheduled") {
    const secsUntilStart = stream.startAt - nowSeconds;
    if (secsUntilStart > 0 && secsUntilStart <= STARTS_SOON_THRESHOLD_S) {
      const mins = Math.ceil(secsUntilStart / 60);
      badges.push({
        key: "starts-soon",
        label: "Starts Soon",
        cssClass: "badge-health badge-health--soon",
        title: `Stream starts in roughly ${mins} minute${mins === 1 ? "" : "s"}.`,
      });
    }
  }

  // ── active ────────────────────────────────────────────────────────────
  if (status === "active") {
    // Claim Pending: meaningful value has vested but recipient hasn't claimed
    // We detect this by checking vestedAmount > 0 while percentComplete > threshold
    if (
      percentComplete > CLAIM_PENDING_MIN_PCT &&
      remainingAmount === stream.totalAmount
    ) {
      badges.push({
        key: "claim-pending",
        label: "Claim Pending",
        cssClass: "badge-health badge-health--claim",
        title: `Over ${CLAIM_PENDING_MIN_PCT}% has vested but no tokens have been claimed yet.`,
      });
    }

    // Almost Done
    if (percentComplete >= ALMOST_DONE_PCT) {
      badges.push({
        key: "almost-done",
        label: "Almost Done",
        cssClass: "badge-health badge-health--ending",
        title: `Stream is ${percentComplete}% complete.`,
      });
    }

    // Expiring Soon: low remaining time
    if (ratePerSecond > 0) {
      const estimatedRemainingSeconds = remainingAmount / ratePerSecond;
      if (
        estimatedRemainingSeconds > 0 &&
        estimatedRemainingSeconds <= EXPIRING_SOON_THRESHOLD_S
      ) {
        const mins = Math.ceil(estimatedRemainingSeconds / 60);
        badges.push({
          key: "expiring-soon",
          label: "Expiring Soon",
          cssClass: "badge-health badge-health--expiring",
          title: `Stream ends in roughly ${mins} minute${mins === 1 ? "" : "s"}.`,
        });
      }
    }
  }

  // ── canceled ──────────────────────────────────────────────────────────
  if (status === "canceled" && stream.canceledAt !== undefined) {
    const secondsSinceCanceled = nowSeconds - stream.canceledAt;
    if (
      secondsSinceCanceled >= 0 &&
      secondsSinceCanceled <= RECENTLY_CANCELED_THRESHOLD_S
    ) {
      badges.push({
        key: "recently-canceled",
        label: "Recently Canceled",
        cssClass: "badge-health badge-health--recent-cancel",
        title: "This stream was canceled within the last 24 hours.",
      });
    }
  }

  return badges;
}
