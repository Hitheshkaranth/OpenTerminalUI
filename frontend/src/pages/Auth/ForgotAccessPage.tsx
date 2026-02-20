import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";

export function ForgotAccessPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const authApi = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
    timeout: 30000,
  });

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.includes("@")) {
      setError("Enter a valid email");
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
      await authApi.post("/auth/forgot-access", {
        email: email.trim(),
        new_password: newPassword,
      });
      setMessage("Access updated. You can now sign in with your new password.");
      window.setTimeout(() => navigate("/login", { replace: true }), 900);
    } catch {
      setError("Could not reset access. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-md rounded border border-terminal-border bg-terminal-panel p-5">
      <h1 className="mb-4 text-lg font-semibold text-terminal-accent">Forgot access</h1>
      <form className="space-y-3" onSubmit={onSubmit}>
        <input
          className="w-full rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
        <input
          className="w-full rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm"
          placeholder="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
        <input
          className="w-full rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm"
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
          {isSubmitting ? "Updating access..." : "Reset access"}
        </button>
      </form>
      <div className="mt-3 text-xs text-terminal-muted">
        Back to <Link className="text-terminal-accent underline" to="/login">Login</Link>
      </div>
    </div>
  );
}
