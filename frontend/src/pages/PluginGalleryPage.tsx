import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPlugins, setPluginEnabled, reloadPlugin, type PluginManifestItem } from "../api/plugins";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalModal } from "../components/terminal/TerminalModal";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { useState } from "react";

function truncate(str: string, maxLen = 100): string {
  if (!str) return "";
  return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
}

export function PluginGalleryPage() {
  const queryClient = useQueryClient();
  const [selectedPlugin, setSelectedPlugin] = useState<PluginManifestItem | null>(null);
  const [filterQuery, setFilterQuery] = useState("");

  const { data: plugins, isLoading, isFetching } = useQuery({
    queryKey: ["plugins"],
    queryFn: fetchPlugins,
    staleTime: 5_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setPluginEnabled(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plugins"] }),
  });

  const reloadMutation = useMutation({
    mutationFn: (id: string) => reloadPlugin(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plugins"] }),
  });

  let filtered = plugins || [];
  if (filterQuery.trim()) {
    const q = filterQuery.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-terminal-accent">Plugin Gallery</div>
          <div className="text-[11px] text-terminal-muted">
            {plugins?.length || 0} plugins · {isFetching ? "Loading..." : ""}
          </div>
        </div>
        <TerminalInput
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Search plugins..."
          className="max-w-xs"
        />
      </div>

      {filtered.length === 0 ? (
        <TerminalPanel title="No Plugins">
          <div className="py-8 text-center text-xs text-terminal-muted">
            {plugins?.length === 0 ? "No plugins installed" : "No plugins match your search"}
          </div>
        </TerminalPanel>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((plugin) => (
            <div
              key={plugin.id}
              className={`cursor-pointer rounded-sm border p-3 transition-colors ${
                selectedPlugin?.id === plugin.id
                  ? "border-terminal-accent bg-terminal-accent/5"
                  : "border-terminal-border hover:border-terminal-accent/50"
              }`}
              onClick={() => setSelectedPlugin(plugin)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-sm text-terminal-text">{plugin.name}</div>
                  <div className="text-[11px] text-terminal-muted">v{plugin.version}</div>
                </div>
                <TerminalBadge
                  variant={plugin.enabled ? "success" : "neutral"}
                  dot
                >
                  {plugin.enabled ? "ENABLED" : "DISABLED"}
                </TerminalBadge>
              </div>
              <div className="mt-2 text-[11px] text-terminal-text">{truncate(plugin.description, 120)}</div>
              <div className="mt-1 text-[10px] text-terminal-muted">by {plugin.author}</div>
              <div className="mt-2 flex items-center gap-1.5">
                <TerminalButton
                  variant={plugin.enabled ? "default" : "accent"}
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleMutation.mutate({ id: plugin.id, enabled: !plugin.enabled });
                  }}
                  loading={toggleMutation.isPending}
                >
                  {plugin.enabled ? "Disable" : "Enable"}
                </TerminalButton>
                <TerminalButton
                  variant="default"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    void reloadMutation.mutate(plugin.id);
                  }}
                  loading={reloadMutation.isPending}
                >
                  Reload
                </TerminalButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <TerminalModal
        open={Boolean(selectedPlugin)}
        onClose={() => setSelectedPlugin(null)}
        title={selectedPlugin?.name || ""}
        subtitle={`v${selectedPlugin?.version || ""}`}
      >
        {selectedPlugin && (
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs font-semibold text-terminal-accent">Description</div>
              <div className="text-xs text-terminal-text">{selectedPlugin.description}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-terminal-muted">Author</div>
                <div className="text-terminal-text">{selectedPlugin.author}</div>
              </div>
              <div>
                <div className="text-terminal-muted">Version</div>
                <div className="text-terminal-text">{selectedPlugin.version}</div>
              </div>
              <div>
                <div className="text-terminal-muted">ID</div>
                <div className="font-mono text-terminal-text">{selectedPlugin.id}</div>
              </div>
              <div>
                <div className="text-terminal-muted">Entry Point</div>
                <div className="font-mono text-terminal-text">{selectedPlugin.entry_point}</div>
              </div>
              <div>
                <div className="text-terminal-muted">Status</div>
                <TerminalBadge variant={selectedPlugin.enabled ? "success" : "neutral"} dot>
                  {selectedPlugin.enabled ? "ENABLED" : "DISABLED"}
                </TerminalBadge>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-terminal-accent">Required Permissions</div>
              <div className="flex flex-wrap gap-1">
                {selectedPlugin.required_permissions.length > 0 ? (
                  selectedPlugin.required_permissions.map((perm) => (
                    <TerminalBadge key={perm} variant="accent">
                      {perm}
                    </TerminalBadge>
                  ))
                ) : (
                  <span className="text-[11px] text-terminal-muted">No permissions required</span>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <TerminalButton
                variant={selectedPlugin.enabled ? "default" : "accent"}
                onClick={() => {
                  void toggleMutation.mutate({ id: selectedPlugin.id, enabled: !selectedPlugin.enabled });
                }}
                loading={toggleMutation.isPending}
              >
                {selectedPlugin.enabled ? "Disable" : "Enable"}
              </TerminalButton>
              <TerminalButton
                variant="default"
                onClick={() => {
                  void reloadMutation.mutate(selectedPlugin.id);
                }}
                loading={reloadMutation.isPending}
              >
                Reload
              </TerminalButton>
            </div>
          </div>
        )}
      </TerminalModal>
    </div>
  );
}