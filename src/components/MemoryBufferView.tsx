import React from "react";
import { ArrowRight, History, Play, Trash2 } from "lucide-react";
import type { MemorySummary } from "../utils/memoryBuffer";
import { MEMORY_WINDOW_SIZE } from "../utils/memoryBuffer";

interface MemoryBufferViewProps {
  summary: MemorySummary;
  onClearMemory: () => void;
  onRunPrompt: (prompt: string) => void;
}

const REFERENCE_FLOWS = [
  {
    title: "In-Notch Music & Memory Recall",
    description: "Play a song directly in the Notch, stop it on command, and recall or replay it.",
    steps: [
      "Play Blinding Lights",
      "Stop the song",
      "What was the last song I played?",
    ],
  },
  {
    title: "Chrome & Relative Folder Repeat",
    description: "Open Chrome, create a folder, and repeat that action using a relative reference.",
    steps: [
      "Open Chrome and search Windows 11 2026",
      "Create folder Budget on Desktop",
      "Do that for Invoices instead",
    ],
  },
];

export const MemoryBufferView: React.FC<MemoryBufferViewProps> = ({
  summary,
  onClearMemory,
  onRunPrompt,
}) => {
  return (
    <div className="space-y-6">
      {/* Header & Summary Strip */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Short-Term Memory Buffer ({MEMORY_WINDOW_SIZE}-Turn Window)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Expanded sliding window tracking the last {MEMORY_WINDOW_SIZE} user interactions for
            relative references across folders, Chrome, apps, and in-Notch songs.
          </p>
        </div>

        <button
          type="button"
          onClick={onClearMemory}
          disabled={summary.entries.length === 0}
          className="flex h-9 items-center gap-2 rounded-lg border border-slate-700 px-3.5 text-xs font-medium text-slate-200 whitespace-nowrap transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear Buffer
        </button>
      </div>

      {/* Key Resolved Entity Pointers */}
      <div className="grid grid-cols-2 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-[#101520] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="p-4">
          <p className="text-xs text-slate-400">Window Occupancy</p>
          <p className="mt-1.5 font-mono text-lg font-semibold text-white tabular-nums">
            {summary.entries.length} / {MEMORY_WINDOW_SIZE}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
            {summary.evictedCount} evicted · {summary.totalRecorded} total
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs text-slate-400">Last App Opened</p>
          <p className="mt-1.5 truncate font-display text-sm font-semibold text-sky-300">
            {summary.lastAppOpened ?? "None in window"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Resolves "close that app"</p>
        </div>

        <div className="p-4">
          <p className="text-xs text-slate-400">Last Song Played</p>
          <p className="mt-1.5 truncate font-display text-sm font-semibold text-emerald-300">
            {summary.lastSongPlayed ?? "None in window"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Resolves "play that song again"</p>
        </div>

        <div className="p-4">
          <p className="text-xs text-slate-400">Last Folder Touched</p>
          <p className="mt-1.5 truncate font-display text-sm font-semibold text-amber-300">
            {summary.lastFolderTouched
              ? `${summary.lastFolderTouched.root}\\${summary.lastFolderTouched.name}`
              : "None in window"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Resolves "do that for ..."</p>
        </div>
      </div>

      {/* Active Sliding Window Records */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#101520]">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="font-display text-sm font-semibold text-slate-100">
            Active {MEMORY_WINDOW_SIZE}-Turn Sliding Window (Oldest → Newest)
          </span>
          <span className="font-mono text-xs text-slate-400">
            deque(maxlen={MEMORY_WINDOW_SIZE})
          </span>
        </div>

        {summary.entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <History className="mb-2.5 h-6 w-6 text-slate-500" />
            <p className="font-display text-sm font-medium text-slate-200">
              Memory Buffer Empty
            </p>
            <p className="mt-1 max-w-md text-xs text-slate-400">
              Interact with Notch AI on the Desktop Simulator or run one of the multi-step flows
              below to populate the {MEMORY_WINDOW_SIZE}-turn sliding window.
            </p>
          </div>
        ) : (
          <div className="max-h-[420px] divide-y divide-slate-800/80 overflow-y-auto">
            {summary.entries.map((entry, idx) => (
              <div
                key={entry.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 w-14 shrink-0 font-mono text-xs text-slate-500 tabular-nums">
                    Slot {idx + 1}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-slate-100">"{entry.userInput}"</p>
                    <p className="text-xs text-slate-300">{entry.assistantReply}</p>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-400">
                      <span>Turn #{entry.turnNumber}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-sky-300">{entry.action}</span>
                      {entry.target && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="max-w-xs truncate">target={entry.target}</span>
                        </>
                      )}
                      {entry.root && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>root={entry.root}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          entry.outcome === "blocked" ? "text-rose-400" : "text-emerald-400"
                        }
                      >
                        {entry.outcome}
                      </span>
                    </div>
                    {entry.resolvedReference && (
                      <p className="font-mono text-[11px] text-sky-300/90">
                        Resolved reference: {entry.resolvedReference}
                      </p>
                    )}
                  </div>
                </div>

                <span className="shrink-0 font-mono text-[11px] text-slate-500 tabular-nums">
                  {entry.timestamp}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Interactive Relative-Reference Test Flows */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {REFERENCE_FLOWS.map((flow) => (
          <div
            key={flow.title}
            className="rounded-xl border border-slate-800 bg-[#101520] p-4"
          >
            <h3 className="font-display text-sm font-semibold text-white">{flow.title}</h3>
            <p className="mt-1 text-xs text-slate-400">{flow.description}</p>
            <div className="mt-3 space-y-2">
              {flow.steps.map((step, i) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => onRunPrompt(step)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:border-sky-500/40 hover:text-sky-200"
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      0{i + 1}.
                    </span>
                    <span className="truncate">{step}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-sky-400">
                    <Play className="h-3 w-3" />
                    Run
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
