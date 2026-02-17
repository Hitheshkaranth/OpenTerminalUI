import { useMemo } from "react";

import { useAuth } from "../../contexts/AuthContext";

export function UserAccountPanel() {
  const { user } = useAuth();

  const initials = useMemo(() => {
    if (!user?.email) return "U";
    const local = user.email.split("@")[0] || "";
    const bits = local.split(/[._-]+/).filter(Boolean);
    if (bits.length >= 2) {
      return `${bits[0][0] || ""}${bits[1][0] || ""}`.toUpperCase();
    }
    return (local.slice(0, 2) || "U").toUpperCase();
  }, [user?.email]);

  if (!user) {
    return (
      <div className="border-t border-terminal-border p-2 text-[11px] text-terminal-muted">
        <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-2">Not signed in</div>
      </div>
    );
  }

  return (
    <div className="border-t border-terminal-border p-2">
      <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-[11px]">
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-terminal-border text-[10px] text-terminal-accent">
            {initials}
          </span>
          <span className="text-terminal-accent uppercase">{user.role}</span>
        </div>
        <div className="truncate text-terminal-text" title={user.email}>
          {user.email}
        </div>
      </div>
    </div>
  );
}
