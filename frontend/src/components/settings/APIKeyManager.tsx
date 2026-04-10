import { useEffect, useState } from "react";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalTable } from "../terminal/TerminalTable";
import { api } from "../../api/client";

interface APIKey {
  id: number;
  name: string;
  prefix: string;
  permissions: string;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
}

export function APIKeyManager() {
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const loadKeys = async () => {
    try {
      const res = await api.get("/api/settings/api-keys");
      setKeys(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("Failed to load API keys", e);
      setKeys([]);
    } finally {
      setInitialLoaded(true);
    }
  };

  const createKey = async () => {
    if (!newKeyName) return;
    setLoading(true);
    try {
      const res = await api.post("/api/settings/api-keys", { name: newKeyName });
      setGeneratedKey(res.data.key);
      setShowModal(true);
      setNewKeyName("");
      void loadKeys();
    } catch (e) {
      console.error("Failed to create API key", e);
    } finally {
      setLoading(false);
    }
  };

  const revokeKey = async (id: number) => {
    if (!confirm("Are you sure you want to revoke this API key?")) return;
    try {
      await api.delete(`/api/settings/api-keys/${id}`);
      void loadKeys();
    } catch (e) {
      console.error("Failed to revoke API key", e);
    }
  };

  useEffect(() => {
    void loadKeys();
  }, []);

  return (
    <div className="space-y-3">
      <TerminalPanel title="Public API Keys" subtitle="Manage access for external applications">
        <div className="flex items-center gap-2 mb-4">
          <TerminalInput
            placeholder="Key Name (e.g. My Python Script)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
          />
          <TerminalButton variant="accent" onClick={createKey} disabled={loading || !newKeyName}>
            {loading ? "Generating..." : "Generate New Key"}
          </TerminalButton>
        </div>

        <TerminalTable
          rows={keys || []}
          rowKey={(row) => String(row?.id || Math.random())}
          emptyText="No API keys generated"
          columns={[
            { key: "name", label: "Name", render: (row) => row.name },
            { key: "prefix", label: "Prefix", render: (row) => <code className="text-terminal-accent">{row.prefix}...</code> },
            { key: "permissions", label: "Permissions", render: (row) => row.permissions },
            { key: "created_at", label: "Created", render: (row) => new Date(row.created_at).toLocaleDateString() },
            { key: "last_used", label: "Last Used", render: (row) => row.last_used_at ? new Date(row.last_used_at).toLocaleString() : "Never" },
            {
              key: "action",
              label: "Action",
              align: "right",
              render: (row) => (
                <TerminalButton variant="danger" onClick={() => revokeKey(row.id)}>
                  Revoke
                </TerminalButton>
              ),
            },
          ]}
        />
      </TerminalPanel>

      {showModal && generatedKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md border border-terminal-accent bg-terminal-panel p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold text-terminal-accent">New API Key Generated</h3>
            <p className="mb-4 text-sm text-terminal-text">
              Save this key now. It will <span className="font-bold text-terminal-pos underline">not be shown again</span> for security reasons.
            </p>
            <div className="mb-6 flex items-center gap-2 rounded border border-terminal-border bg-terminal-bg p-3 font-mono text-sm text-terminal-text">
              <span className="break-all">{generatedKey}</span>
              <TerminalButton
                onClick={() => {
                  void navigator.clipboard.writeText(generatedKey);
                  alert("Copied to clipboard");
                }}
              >
                Copy
              </TerminalButton>
            </div>
            <div className="flex justify-end">
              <TerminalButton variant="accent" onClick={() => setShowModal(false)}>
                I have saved it
              </TerminalButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
