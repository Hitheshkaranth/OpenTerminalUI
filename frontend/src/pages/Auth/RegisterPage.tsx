import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { MarketTicker } from "../../components/MarketTicker";
import { StatusBar } from "../../components/StatusBar";
import { useAuth, type AuthRole } from "../../contexts/AuthContext";
import logo from "../../assets/logo.png";

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<AuthRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const { register, login, isLoading } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email.includes("@")) {
      setError("ENTER A VALID EMAIL");
      return;
    }
    if (password.length < 8) {
      setError("PASSWORD MUST BE AT LEAST 8 CHARACTERS");
      return;
    }
    if (password !== confirmPassword) {
      setError("PASSWORDS DO NOT MATCH");
      return;
    }

    try {
      await register(email.trim(), password, role);
      await login(email.trim(), password);
      navigate("/equity/stocks", { replace: true });
    } catch {
      setError("REGISTRATION FAILED");
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
          <p className="ot-brand-subtitle">Create secure terminal access.</p>
        </div>
      </section>

      <section className="ot-login-panel">
        <div className="ot-login-panel-inner">
          <header className="ot-stagger" style={{ ["--stagger-index" as string]: 1 }}>
            <div className="ot-panel-logo-wrap">
              <img src={logo} alt="OpenTerminalUI logo" className="ot-panel-logo" />
            </div>
            <p className="ot-panel-kicker">NEW OPERATOR</p>
            <h2 className="ot-panel-title">REQUEST ACCESS</h2>
            <p className="ot-panel-subtitle">Provision your terminal credentials</p>
            <span className="ot-panel-divider" />
          </header>

          <form className="ot-login-form" onSubmit={onSubmit}>
            <label className="ot-field-label ot-stagger" style={{ ["--stagger-index" as string]: 2 }} htmlFor="ot-register-email">
              EMAIL
            </label>
            <div className="ot-input-wrap ot-stagger" style={{ ["--stagger-index" as string]: 3 }}>
              <span className="ot-input-prompt">&gt;</span>
              <input
                id="ot-register-email"
                className="ot-input"
                placeholder="Enter email..."
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                disabled={isLoading}
              />
            </div>

            <label className="ot-field-label ot-stagger" style={{ ["--stagger-index" as string]: 4 }} htmlFor="ot-register-password">
              PASSWORD
            </label>
            <div className="ot-input-wrap ot-stagger" style={{ ["--stagger-index" as string]: 5 }}>
              <span className="ot-input-prompt">&gt;</span>
              <input
                id="ot-register-password"
                className="ot-input"
                type="password"
                placeholder="Create password..."
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isLoading}
              />
            </div>

            <label className="ot-field-label ot-stagger" style={{ ["--stagger-index" as string]: 6 }} htmlFor="ot-register-confirm-password">
              CONFIRM PASSWORD
            </label>
            <div className="ot-input-wrap ot-stagger" style={{ ["--stagger-index" as string]: 7 }}>
              <span className="ot-input-prompt">&gt;</span>
              <input
                id="ot-register-confirm-password"
                className="ot-input"
                type="password"
                placeholder="Confirm password..."
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                disabled={isLoading}
              />
            </div>

            <label className="ot-field-label ot-stagger" style={{ ["--stagger-index" as string]: 8 }} htmlFor="ot-register-role">
              ROLE
            </label>
            <div className="ot-input-wrap ot-stagger" style={{ ["--stagger-index" as string]: 9 }}>
              <span className="ot-input-prompt">&gt;</span>
              <select
                id="ot-register-role"
                className="ot-input"
                value={role}
                onChange={(event) => setRole(event.target.value as AuthRole)}
                disabled={isLoading}
              >
                <option value="viewer">VIEWER</option>
                <option value="trader">TRADER</option>
                <option value="admin">ADMIN</option>
              </select>
            </div>

            <button type="submit" className="ot-login-submit ot-stagger" style={{ ["--stagger-index" as string]: 10 }} disabled={isLoading}>
              {isLoading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}
            </button>

            {error ? <p className="ot-auth-error">{error}</p> : null}

            <footer className="ot-login-footer ot-stagger" style={{ ["--stagger-index" as string]: 11 }}>
              <p>
                Already registered? <Link to="/login">Access terminal</Link>
              </p>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}
