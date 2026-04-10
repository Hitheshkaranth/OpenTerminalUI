import { useState } from "react";
import { ArrowDownTrayIcon, ClipboardIcon, DocumentArrowDownIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import { TerminalButton } from "../terminal/TerminalButton";
import { api } from "../../api/client";

interface ExportButtonProps {
  source: string;
  data: any[];
  filename?: string;
  disabled?: boolean;
}

export function ExportButton({ source, data, filename, disabled }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowModal] = useState(false);

  const handleExport = async (format: "csv" | "excel") => {
    setLoading(true);
    try {
      const fname = filename || `${source}_export_${new Date().toISOString().split("T")[0]}.${format === "csv" ? "csv" : "xlsx"}`;
      
      if (format === "csv") {
        const res = await api.post("/api/export/csv", { source, data, filename: fname }, { responseType: "blob" });
        downloadBlob(res.data, fname);
      } else {
        const res = await api.post("/api/export/excel", { source, sheets: { [source]: data }, filename: fname }, { responseType: "blob" });
        downloadBlob(res.data, fname);
      }
    } catch (e) {
      console.error("Export failed", e);
    } finally {
      setLoading(false);
      setShowModal(false);
    }
  };

  const copyToClipboard = () => {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(h => row[h]).join("\t"));
    const content = [headers.join("\t"), ...rows].join("\n");
    void navigator.clipboard.writeText(content);
    alert("Copied to clipboard (Tab-separated)");
    setShowModal(false);
  };

  const downloadBlob = (blob: Blob, fname: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <div className="relative inline-block text-left">
      <TerminalButton
        onClick={() => setShowModal(!showDropdown)}
        disabled={disabled || !data.length || loading}
        title="Export data"
      >
        <div className="flex items-center gap-1">
          <ArrowDownTrayIcon className="h-3.5 w-3.5" />
          <span>{loading ? "..." : "Export"}</span>
        </div>
      </TerminalButton>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowModal(false)} />
          <div className="absolute right-0 mt-1 w-40 origin-top-right rounded-sm border border-terminal-border bg-terminal-panel shadow-lg ring-1 ring-black ring-opacity-5 z-50">
            <div className="py-1">
              <button
                onClick={() => handleExport("csv")}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"
              >
                <DocumentArrowDownIcon className="h-3.5 w-3.5" />
                <span>Export to CSV</span>
              </button>
              <button
                onClick={() => handleExport("excel")}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"
              >
                <TableCellsIcon className="h-3.5 w-3.5" />
                <span>Export to Excel</span>
              </button>
              <button
                onClick={copyToClipboard}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text border-t border-terminal-border mt-1"
              >
                <ClipboardIcon className="h-3.5 w-3.5" />
                <span>Copy to Clipboard</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
