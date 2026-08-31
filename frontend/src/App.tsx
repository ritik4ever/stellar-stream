import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DarkModeToggle } from "./components/DarkModeToggle";
import { LanguageSelector } from "./components/LanguageSelector";
import { OfflineBanner } from "./components/OfflineBanner";
import { WalletButton } from "./components/WalletButton";
import { useFreighter } from "./hooks/useFreighter";
import { useTheme } from "./hooks/useTheme";
import { DashboardPage } from "./pages/DashboardPage";

const SenderDashboard = lazy(() =>
  import("./components/SenderDashboard").then((m) => ({ default: m.SenderDashboard })),
);
const RecipientDashboard = lazy(() =>
  import("./components/RecipientDashboard").then((m) => ({ default: m.RecipientDashboard })),
);

function AppContent() {
  const { t } = useTranslation();
  const wallet = useFreighter();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    if (path !== "/" && path !== "/sender" && path !== "/recipient") {
      navigate("/");
    }
  }, [location.pathname, navigate]);

  const currentTab =
    location.pathname === "/sender"
      ? "sender"
      : location.pathname === "/recipient"
        ? "recipient"
        : "dashboard";

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">{t("app.eyebrow")}</p>
            <h1>{t("app.title")}</h1>
          </div>

          <DarkModeToggle theme={theme} onToggle={toggleTheme} />

          <WalletButton wallet={wallet} />
        </div>
        <p className="hero-copy">{t("app.heroCopy")}</p>
      </header>

      <nav className="app-nav" aria-label="Main">
        <button
          type="button"
          className={`app-nav-link ${currentTab === "dashboard" ? "app-nav-link--active" : ""}`}
          onClick={() => navigate("/")}
        >
          {t("nav.dashboard")}
        </button>
        <button
          type="button"
          className={`app-nav-link ${currentTab === "sender" ? "app-nav-link--active" : ""}`}
          onClick={() => navigate("/sender")}
        >
          {t("nav.sender")}
        </button>
        <button
          type="button"
          className={`app-nav-link ${currentTab === "recipient" ? "app-nav-link--active" : ""}`}
          onClick={() => navigate("/recipient")}
        >
          {t("nav.recipient")}
        </button>
      </nav>

      <OfflineBanner />

      <Suspense fallback={<div className="app-shell">Loading...</div>}>
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
        </Routes>
      </Suspense>

      <footer className="app-footer">
        <LanguageSelector />
      </footer>
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