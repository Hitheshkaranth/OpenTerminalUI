import { useState, useCallback } from "react";

import { saveProviderKeys, type ProviderKeysResponse, type ProviderKeyRow } from "../../api/providerKeys";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalBadge } from "../terminal/TerminalBadge";

type Props = {
  providerId: string;
  envKeys: string[];
  rows: ProviderKeyRow[];
  onSaved: (r: ProviderKeysResponse) => void;
};

function buildMaskedPlaceholder(masked: string | null): string {
  if (masked) return `current: ${masked}`;
  return "not set";
}

export function ProviderKeyForm({ providerId, envKeys, rows, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Iterate the provider's env keys (not the fetched rows) so every key gets an input
  // even before the keys query has loaded; the row only supplies the masked hint.
  const keyedRows: ProviderKeyRow[] = envKeys.map(
    (name) => rows.find((r) => r.name === name) ?? { name, provider: providerId, set: false, masked: null, source: "unset" },
  );

  const handleChange = useCallback((name: string, val: string) => {
    setValues((prev) => ({ ...prev, [name]: val }));
    setDirty((prev) => ({ ...prev, [name]: true }));
    setError(null);
    setSuccess(null);
  }, []);

  const handleClear = useCallback((name: string) => {
    setValues((prev) => ({ ...prev, [name]: "" }));
    setDirty((prev) => ({ ...prev, [name]: true }));
    setError(null);
    setSuccess(null);
  }, []);

  const handleToggleShow = useCallback((name: string) => {
    setShow((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const hasDirtyValues = Object.keys(dirty).length > 0;

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await saveProviderKeys(values);
      const changedKeys = Object.keys(values);
      const applied = res.applied_live?.filter((k) => changedKeys.includes(k));
      const needsRestart = res.restart_required?.filter((k) => changedKeys.includes(k));
      let msg = "Saved.";
      if (applied && applied.length > 0) {
        msg += ` Applied live: ${applied.join(", ")}`;
      }
      if (needsRestart && needsRestart.length > 0) {
        msg += ` Restart the backend to apply: ${needsRestart.join(", ")}`;
      }
      setSuccess(msg);
      onSaved(res);
    } catch (e: unknown) {
      let handled = false;
      if (e && typeof e === "object" && "response" in e) {
        const resp = e as { response?: { status?: number; data?: { detail?: string | string[] } } };
        const status = resp.response?.status;
        const detail = resp.response?.data?.detail;
        if (status === 422 || status === 403) {
          if (typeof detail === "string") {
            setError(detail);
            handled = true;
          } else if (Array.isArray(detail) && detail.length) {
            setError(detail.join("; "));
            handled = true;
          }
        }
      }
      if (!handled) {
        setError("Failed to save keys");
      }
    } finally {
      setLoading(false);
    }
  };

  if (keyedRows.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 rounded-sm border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-[11px] font-semibold text-terminal-muted">
        {providerId} — Provider Keys
      </div>

      {keyedRows.map((row) => {
        const isShowing = show[row.name];
        const masked = buildMaskedPlaceholder(row.masked);
        const value = dirty[row.name] ? (values[row.name] ?? "") : "";

        return (
          <div key={row.name} className="mb-2 last:mb-0">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-xs text-terminal-text" htmlFor={`pk-${row.name}`}>
                  {row.name}
                </label>
                <span className="text-[10px] text-terminal-muted">({row.source})</span>
              </div>
              {dirty[row.name] && (
                <button
                  type="button"
                  className="text-[10px] text-terminal-muted underline hover:text-terminal-text"
                  onClick={() => handleClear(row.name)}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <TerminalInput
                id={`pk-${row.name}`}
                type={isShowing ? "text" : "password"}
                value={value}
                onChange={(e) => handleChange(row.name, e.target.value)}
                placeholder={masked}
                size="sm"
              />
              <TerminalButton
                size="sm"
                variant="ghost"
                onClick={() => handleToggleShow(row.name)}
              >
                {isShowing ? "Hide" : "Show"}
              </TerminalButton>
            </div>
          </div>
        );
      })}

      {error && (
        <div className="mb-2 rounded-sm border border-terminal-neg bg-terminal-neg/10 px-2 py-1 text-[11px] text-terminal-neg">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-2 rounded-sm border border-terminal-pos bg-terminal-pos/10 px-2 py-1 text-[11px] text-terminal-pos">
          {success}
        </div>
      )}

      <div className="flex justify-end">
        <TerminalButton
          variant="accent"
          size="sm"
          loading={loading}
          disabled={!hasDirtyValues || loading}
          onClick={handleSave}
        >
          Save
        </TerminalButton>
      </div>
    </div>
  );
}