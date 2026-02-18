import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { MarketTicker } from "../components/MarketTicker";
import { StatusBar } from "../components/StatusBar";
import { useAuth } from "../contexts/AuthContext";
import logo from "../assets/logo.png";

const TRANSITION_FLAG_KEY = "ot-terminal-transition";

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading } = useAuth();

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [rememberTerminal, setRememberTerminal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [dotIndex, setDotIndex] = useState(1);
  const [inputErrorFlash, setInputErrorFlash] = useState(false);

  useEffect(() => {
    const remembered = localStorage.getItem("ot-login-user");
    if (remembered) {
      setUserId(remembered);
      setRememberTerminal(true);
    }
  }, []);

  useEffect(() => {
    if (!authenticating) return;
    const timer = window.setInterval(() => {
      setDotIndex((prev) => (prev % 3) + 1);
    }, 320);
    return () => window.clearInterval(timer);
  }, [authenticating]);

  const authText = useMemo(() => `AUTHENTICATING${".".repeat(dotIndex)}`, [dotIndex]);

  const triggerInputFlash = () => {
    setInputErrorFlash(true);
    window.setTimeout(() => setInputErrorFlash(false), 420);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!userId.trim() || !password) {
      setError("CREDENTIALS REQUIRED");
      triggerInputFlash();
      return;
    }

    if (!userId.includes("@")) {
      setError("USER ID MUST BE A REGISTERED EMAIL");
      triggerInputFlash();
      return;
    }

    try {
      setAuthenticating(true);
      const startedAt = Date.now();
      await login(userId.trim(), password);

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < 2000) {
        await delay(2000 - elapsedMs);
      }

      if (rememberTerminal) {
        localStorage.setItem("ot-login-user", userId.trim());
      } else {
        localStorage.removeItem("ot-login-user");
      }

      sessionStorage.setItem(TRANSITION_FLAG_KEY, "1");
      window.dispatchEvent(new CustomEvent("ot-terminal-transition"));
      await delay(800);

      const redirectParam = new URLSearchParams(location.search).get("redirect");
      const fallback = (location.state as { from?: string } | undefined)?.from || "/home";
      navigate(redirectParam || fallback, { replace: true });
    } catch {
      setError("AUTHENTICATION FAILED");
      triggerInputFlash();
    } finally {
      setAuthenticating(false);
    }
  };

  return (
    <div className="ot-login-layout">
      <StatusBar left="OPENTERMINALUI" center="SYSTEM STATUS: ONLINE" centerDotColor="green" />

      <section className="ot-login-hero">
        <div className="ot-login-ticker-wrap">
          <MarketTicker />
        </div>

        <div className="ot-login-metrics">
          <span className="ot-value-up">UPTIME 99.97%</span>
          <span className="ot-muted">|</span>
          <span className="ot-value-cyan">LATENCY 2ms</span>
          <span className="ot-muted">|</span>
          <span className="ot-value-amber">SESSIONS 1,247</span>
        </div>

        <div className="ot-brand-block">
          <div className="ot-brand-logo-row">
            <img src={logo} alt="OpenTerminalUI" className="ot-brand-logo" />
            <span className="ot-brand-kicker">OPEN-SOURCE TRADING TERMINAL</span>
          </div>
          <h1 className="ot-brand-title">
            <span className="ot-brand-title-open">OPENTERMINALUI</span>
          </h1>
          <p className="ot-brand-subtitle">Analyze. Trade. Optimize.</p>
        </div>
      </section>

      <section className="ot-login-panel">
        <div className="ot-login-panel-inner">
          <header className="ot-stagger" style={{ ["--stagger-index" as string]: 1 }}>
            <div className="ot-panel-logo-wrap">
              <img src={logo} alt="OpenTerminalUI logo" className="ot-panel-logo" />
            </div>
            <p className="ot-panel-kicker">SECURE ACCESS</p>
            <h2 className="ot-panel-title">AUTHENTICATE</h2>
            <p className="ot-panel-subtitle">Enter credentials to access terminal</p>
            <span className="ot-panel-divider" />
          </header>

          <form className="ot-login-form" onSubmit={onSubmit}>
            <label className="ot-field-label ot-stagger" style={{ ["--stagger-index" as string]: 2 }} htmlFor="ot-user-id">
              USER ID
            </label>
            <div className={`ot-input-wrap ot-stagger ${inputErrorFlash ? "ot-input-flash" : ""}`} style={{ ["--stagger-index" as string]: 3 }}>
              <span className="ot-input-prompt">&gt;</span>
              <input
                id="ot-user-id"
                className="ot-input"
                placeholder="Enter user ID..."
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                autoComplete="username"
                disabled={authenticating || isLoading}
              />
            </div>

            <label className="ot-field-label ot-stagger" style={{ ["--stagger-index" as string]: 4 }} htmlFor="ot-password">
              PASSWORD
            </label>
            <div className={`ot-input-wrap ot-input-password-wrap ot-stagger ${inputErrorFlash ? "ot-input-flash" : ""}`} style={{ ["--stagger-index" as string]: 5 }}>
              <span className="ot-input-prompt">&gt;</span>
              <input
                id="ot-password"
                className="ot-input ot-password-input"
                type={showPassword ? "text" : "password"}
                placeholder="Enter password..."
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={authenticating || isLoading}
              />
              <button
                type="button"
                className="ot-password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "?" : "?"}
              </button>
            </div>

            <div className="ot-options-row ot-stagger" style={{ ["--stagger-index" as string]: 6 }}>
              <label className="ot-checkbox">
                <input type="checkbox" checked={rememberTerminal} onChange={(event) => setRememberTerminal(event.target.checked)} />
                <span className="ot-checkbox-mark" />
                <span>Remember terminal</span>
              </label>
              <Link to="/register" className="ot-forgot-link">Forgot access?</Link>
            </div>

            <button type="submit" className="ot-login-submit ot-stagger" style={{ ["--stagger-index" as string]: 7 }} disabled={authenticating || isLoading}>
              {authenticating || isLoading ? authText : "ACCESS TERMINAL ?"}
            </button>

            {error ? <p className="ot-auth-error">{error}</p> : null}

            <div className="ot-or-divider ot-stagger" style={{ ["--stagger-index" as string]: 8 }}>
              <span />
              <p>OR</p>
              <span />
            </div>

            <button
              type="button"
              className="ot-demo-button ot-stagger"
              style={{ ["--stagger-index" as string]: 9 }}
              onClick={() => {
                setUserId("demo@openterminal.dev");
                setPassword("demo12345");
                setError(null);
              }}
            >
              <span>&gt;</span> DEMO ACCESS
            </button>
          </form>

          <footer className="ot-login-footer ot-stagger" style={{ ["--stagger-index" as string]: 10 }}>
            <p>
              New to OpenTerminal? <Link to="/register">Request access</Link>
            </p>
            <p className="ot-login-meta">v1.0.0 | MIT LICENSE | github.com/Hitheshkaranth/OpenTerminalUI</p>
          </footer>
        </div>
      </section>
    </div>
  );
}
