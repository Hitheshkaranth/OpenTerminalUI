import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth, type AuthRole } from "../../contexts/AuthContext";

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AuthRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const { register, login, isLoading } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) {
      setError("Enter a valid email");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    try {
      await register(email, password, role);
      await login(email, password);
      navigate("/equity/stocks", { replace: true });
    } catch {
      setError("Registration failed");
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-md rounded border border-terminal-border bg-terminal-panel p-5">
      <h1 className="mb-4 text-lg font-semibold text-terminal-accent">Register</h1>
      <form className="space-y-3" onSubmit={onSubmit}>
        <input className="w-full rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <select className="w-full rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as AuthRole)}>
          <option value="viewer">Viewer</option>
          <option value="trader">Trader</option>
          <option value="admin">Admin</option>
        </select>
        {error ? <div className="text-xs text-terminal-neg">{error}</div> : null}
        <button disabled={isLoading} className="w-full rounded border border-terminal-accent px-3 py-2 text-sm text-terminal-accent disabled:opacity-60">
          {isLoading ? "Creating account..." : "Create account"}
        </button>
      </form>
      <div className="mt-3 text-xs text-terminal-muted">
        Have an account? <Link className="text-terminal-accent underline" to="/login">Login</Link>
      </div>
    </div>
  );
}
