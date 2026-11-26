import React, { useMemo, useState } from "react";
import { Download, FileText, Search } from "lucide-react";
import type { AuditCategory, AuditEvent } from "../types/notch";

interface AuditLogViewProps {
  events: AuditEvent[];
}

const CATEGORIES: Array<{ id: "all" | AuditCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "security", label: "Security" },
  { id: "folder", label: "Folders" },
  { id: "app", label: "Apps" },
  { id: "mouse", label: "Mouse" },
  { id: "memory", label: "Memory" },
];

export const AuditLogView: React.FC<AuditLogViewProps> = ({ events }) => {
  const [filter, setFilter] = useState<"all" | AuditCategory>("all");
  const [search, setSearch] = useState("");
  const [rawMode, setRawMode] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((ev) => {
      if (filter !== "all" && ev.category !== filter) return false;
      if (!q) return true;
      return (
        ev.event.toLowerCase().includes(q) ||
        ev.detail.toLowerCase().includes(q) ||
        ev.category.toLowerCase().includes(q) ||
        ev.status.toLowerCase().includes(q)
      );
    });
  }, [events, filter, search]);

  const jsonlOutput = useMemo(
    () =>
      filtered
        .map((ev) =>
          JSON.stringify({
            timestamp: ev.timestamp,
            category: ev.category,
            event: ev.event,
            status: ev.status,
            detail: ev.detail,
            actor: ev.actor,
            prev_hash: ev.prevHash,
            entry_hash: ev.entryHash,
          })
        )
        .join("\n"),
    [filtered]
  );

  const handleExportJsonl = () => {
    const blob = new Blob([jsonlOutput + "\n"], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit.jsonl";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Structured Audit Log (audit.jsonl)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Hash-chained JSONL trail recording every unlock attempt, sandboxed folder mutation, app
            action, memory recall, and mouse automation event.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRawMode((v) => !v)}
            className="h-9 rounded-lg border border-slate-700 px-3.5 text-xs font-medium text-slate-200 whitespace-nowrap hover:border-slate-500 hover:text-white"
          >
            {rawMode ? "Table View" : "Raw JSONL"}
          </button>
          <button
            type="button"
            onClick={handleExportJsonl}
            className="flex h-9 items-center gap-2 rounded-lg bg-sky-500 px-3.5 text-xs font-semibold text-slate-950 whitespace-nowrap hover:bg-sky-400"
          >
            <Download className="h-3.5 w-3.5" />
            Export audit.jsonl
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#101520] p-1 border border-slate-800">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFilter(cat.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                filter === cat.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter audit events..."
            className="h-9 w-full rounded-lg border border-slate-800 bg-[#101520] pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Table or Raw JSONL Container */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#101520]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-2 h-6 w-6 text-slate-500" />
            <p className="font-display text-sm font-medium text-slate-200">
              No matching audit records
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Try clearing the search query or running an action in the Desktop Simulator.
            </p>
          </div>
        ) : rawMode ? (
          <pre className="max-h-[520px] overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200">
            {jsonlOutput}
          </pre>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Detail</th>
                  <th className="px-4 py-3 text-right">Entry Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filtered.map((ev) => (
                  <tr key={ev.id} className="hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-slate-400 tabular-nums">
                      {ev.timestamp}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium capitalize text-slate-300">
                      {ev.category}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-100">
                      {ev.event}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium">
                      <span
                        className={
                          ev.status === "blocked"
                            ? "text-rose-400"
                            : ev.status === "warning"
                            ? "text-amber-400"
                            : "text-emerald-400"
                        }
                      >
                        {ev.status === "blocked"
                          ? "Blocked"
                          : ev.status === "warning"
                          ? "Warning"
                          : "Allowed"}
                      </span>
                    </td>
                    <td className="max-w-md truncate px-4 py-2.5 text-slate-300" title={ev.detail}>
                      {ev.detail}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-[11px] text-slate-500 tabular-nums">
                      {ev.entryHash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
