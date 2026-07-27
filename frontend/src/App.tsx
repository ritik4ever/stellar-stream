import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { DarkModeToggle } from "./components/DarkModeToggle";
import { OfflineBanner } from "./components/OfflineBanner";
import { WalletButton } from "./components/WalletButton";
import { useFreighter } from "./hooks/useFreighter";
import { useTheme } from "./hooks/useTheme";
import { DashboardPage } from "./pages/DashboardPage";
import { AdminOpsPage } from "./pages/AdminOps";
import { isAdminUser } from "./services/auth";

const SenderDashboard = lazy(() =>
  import("./components/SenderDashboard").then((m) => ({ default: m.SenderDashboard })),
);
const RecipientDashboard = lazy(() =>
  import("./components/RecipientDashboard").then((m) => ({ default: m.RecipientDashboard })),
);

function AdminOpsRoute() {
  const isAdmin = isAdminUser();
  return isAdmin ? <AdminOpsPage isAdmin /> : <Navigate to="/" replace />;
}

function AppContent() {
  const wallet = useFreighter();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = isAdminUser();

  useEffect(() => {
    const path = location.pathname;
    if (path !== "/" && path !== "/sender" && path !== "/recipient" && path !== "/admin/ops") {
      navigate("/");
    }
  }, [location.pathname, navigate]);

  const currentTab =
    location.pathname === "/sender"
      ? "sender"
      : location.pathname === "/recipient"
        ? "recipient"
        : location.pathname === "/admin/ops"
          ? "admin-ops"
          : "dashboard";

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">Soroban-native MVP</p>
            <h1>StellarStream</h1>
          </div>

          <DarkModeToggle theme={theme} onToggle={toggleTheme} />

          <WalletButton wallet={wallet} />
        </div>
        <p className="hero-copy">
          Continuous on-chain style payments for salaries, subscriptions, and
          freelancer payouts on Stellar.
        </p>
      </header>

      <nav className="app-nav" aria-label="Main">
        <button
          type="button"
          className={`app-nav-link ${currentTab === "dashboard" ? "app-nav-link--active" : ""}`}
          onClick={() => navigate("/")}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={`app-nav-link ${currentTab === "sender" ? "app-nav-link--active" : ""}`}
          onClick={() => navigate("/sender")}
        >
          Sender dashboard
        </button>
        <button
          type="button"
          className={`app-nav-link ${currentTab === "recipient" ? "app-nav-link--active" : ""}`}
          onClick={() => navigate("/recipient")}
        >
          Recipient dashboard
        </button>
        {isAdmin ? (
          <button
            type="button"
            className={`app-nav-link ${currentTab === "admin-ops" ? "app-nav-link--active" : ""}`}
            onClick={() => navigate("/admin/ops")}
          >
            Admin Ops
          </button>
        ) : null}
      </nav>

      <OfflineBanner />

      <Suspense fallback={<div className="app-shell">Loading…</div>}>
        <Routes>
          <Route path="/" element={<DashboardPage wallet={wallet} />} />
          <Route
            path="/sender"
            element={<SenderDashboard senderAddress={wallet.address} onEditStartTime={() => {}} />}
          />
          <Route
            path="/recipient"
            element={<RecipientDashboard recipientAddress={wallet.address} />}
          />
          <Route path="/admin/ops" element={<AdminOpsRoute />} />
        </Routes>
      </Suspense>
    </div>
  );
}

function App() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;