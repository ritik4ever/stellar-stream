import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnboardingStatus, markDashboardVisited } from "../hooks/useOnboardingStatus";
import type { FreighterState } from "../hooks/useFreighter";

const SEEN_KEY = "onboarding:seen";
const DISMISSED_KEY = "onboarding:dismissed";

interface OnboardingChecklistProps {
  wallet: FreighterState;
  forceOpen?: boolean;
  onClose?: () => void;
}

interface ChecklistStep {
  key: string;
  label: string;
  done: boolean;
  path: string;
}

export function OnboardingChecklist({ wallet, forceOpen, onClose }: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const status = useOnboardingStatus(wallet);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === "true"
  );

  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY) !== "true") {
      localStorage.setItem(SEEN_KEY, "true");
    }
  }, []);

  const visible = forceOpen || !dismissed;
  if (!visible) return null;

  const steps: ChecklistStep[] = [
    { key: "wallet", label: "Connect your wallet", done: status.walletConnected, path: "/" },
    { key: "stream", label: "Create a stream", done: status.streamCreated, path: "/sender" },
    { key: "monitor", label: "Monitor stream progress", done: status.progressMonitored, path: "/" },
    { key: "claim", label: "Claim tokens", done: status.tokensClaimed, path: "/recipient" },
  ];

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
    onClose?.();
  };

  return (
    <div
      className="card"
      role="dialog"
      aria-label="Onboarding checklist"
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        width: "300px",
        padding: "1rem",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Getting started</h3>
        <button
          type="button"
          className="btn-ghost"
          aria-label="Dismiss onboarding checklist"
          onClick={handleDismiss}
          style={{ padding: "2px 8px" }}
        >
          ✕
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, marginTop: "0.75rem" }}>
        {steps.map((step) => (
          <li
            key={step.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.4rem 0",
              cursor: "pointer",
            }}
            onClick={() => {
              if (step.key === "monitor") markDashboardVisited();
              navigate(step.path);
            }}
          >
            <span aria-hidden>{step.done ? "✅" : "⬜"}</span>
            <span
              style={{
                textDecoration: step.done ? "line-through" : "none",
                opacity: step.done ? 0.6 : 1,
                fontSize: "0.875rem",
              }}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}