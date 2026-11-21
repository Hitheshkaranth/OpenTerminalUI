import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";

type Step = "request" | "reset";

const inputClass = "w-full rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm";

export function ForgotAccessPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const authApi = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
    timeout: 30000,
  });

  const statusOf = (err: unknown) => (err as { response?: { status?: number } } | null)?.response?.status;

  // Step 1: ask the server to issue a single-use reset token. The response is
  // always 204 (it never reveals whether the account exists, and never contains
  // the token); the token is delivered out of band by the operator.
  const onRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.includes("@")) {
      setError("Enter a valid email");
      return;
    }

    try {
      setIsSubmitting(true);
      await authApi.post("/auth/forgot-access", { email: email.trim() });
      setMessage(
        "If that account exists, a reset token has been issued. Get it from your administrator, then enter it below. It expires in 30 minutes.",
      );
      setStep("reset");
    } catch (err) {
      setError(statusOf(err) === 429 ? "Too many requests. Try again later." : "Could not request a reset. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: redeem the token and set the new password.
  const onReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!token.trim()) {
      setError("Enter the reset token");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      setIsSubmitting(true);
      await authApi.post("/auth/reset-password", {
        token: token.trim(),
        new_password: newPassword,
      });
      setMessage("Password updated. You can now sign in with your new password.");
      window.setTimeout(() => navigate("/login", { replace: true }), 900);
    } catch (err) {
      const status = statusOf(err);
      if (status === 400) {
        setError("Reset token is invalid, expired, or already used. Request a new one.");
      } else if (status === 429) {
        setError("Too many attempts. Try again later.");
      } else {
        setError("Could not reset access. Try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-md rounded border border-terminal-border bg-terminal-panel p-5">
      <h1 className="mb-4 text-lg font-semibold text-terminal-accent">Forgot access</h1>
      {step === "request" ? (
        <form className="space-y-3" onSubmit={onRequest}>
          <input
            className={inputClass}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
          {error ? <div className="text-xs text-terminal-neg">{error}</div> : null}
          {message ? <div className="text-xs text-terminal-pos">{message}</div> : null}
          <button
            disabled={isSubmitting}
            className="w-full rounded border border-terminal-accent px-3 py-2 text-sm text-terminal-accent disabled:opacity-60"
          >
            {isSubmitting ? "Requesting..." : "Request reset token"}
          </button>
          <button
            type="button"
            className="w-full text-xs text-terminal-muted underline"
            onClick={() => {
              setError(null);
              setMessage(null);
              setStep("reset");
            }}
          >
            I already have a reset token
          </button>
        </form>
      ) : (
        <form className="space-y-3" onSubmit={onReset}>
          <input
            className={inputClass}
            placeholder="Reset token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="one-time-code"
            spellCheck={false}
          />
          <input
            className={inputClass}
            placeholder="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <input
            className={inputClass}
            placeholder="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
          {error ? <div className="text-xs text-terminal-neg">{error}</div> : null}
          {message ? <div className="text-xs text-terminal-pos">{message}</div> : null}
          <button
            disabled={isSubmitting}
            className="w-full rounded border border-terminal-accent px-3 py-2 text-sm text-terminal-accent disabled:opacity-60"
          >
            {isSubmitting ? "Updating access..." : "Set new password"}
          </button>
          <button
            type="button"
            className="w-full text-xs text-terminal-muted underline"
            onClick={() => {
              setError(null);
              setMessage(null);
              setStep("request");
            }}
          >
            Request a new token
          </button>
        </form>
      )}
      <div className="mt-3 text-xs text-terminal-muted">
        Back to <Link className="text-terminal-accent underline" to="/login">Login</Link>
      </div>
    </div>
  );
}
