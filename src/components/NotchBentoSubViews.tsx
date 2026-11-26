import React, { useMemo, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Folder,
  Hand,
  Lock,
  Mic,
  Music2,
  Pause,
  PhoneOff,
  Play,
  Plus,
  RotateCw,
  Search,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
} from "lucide-react";
import type {
  DesktopApp,
  GroundingSource,
  SongTrack,
  VaultState,
  VirtualFolder,
} from "../types/notch";
import { MEMORY_WINDOW_SIZE } from "../utils/memoryBuffer";

export type NotchSubView = "bento" | "media" | "monitor" | "calendar" | "notes" | "ai";

export interface NotchNote {
  id: string;
  content: string;
  updatedAt: string;
}

export interface CalendarReminder {
  id: string;
  dateKey: string; // YYYY-MM-DD
  text: string;
  time: string;
  done: boolean;
}

export interface TelemetrySnapshot {
  cpuHistory: number[];
  cpuCurrent: number;
  ramPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  netDownMbps: number;
  netUpMbps: number;
}

const PROTECTED_PROCS = [
  { name: "Windows Explorer", processName: "explorer.exe", cpu: 2.1, memMb: 142 },
  { name: "Service Host", processName: "svchost.exe", cpu: 1.4, memMb: 96 },
  { name: "Local Security Authority", processName: "lsass.exe", cpu: 0.4, memMb: 38 },
];

function buildSyncedLyrics(track: SongTrack | null): string[] {
  if (!track) {
    return [
      "No track is playing yet.",
      "Search for any song on the left or ask NOVA AI to play a track.",
      "Audio streams directly inside the notch without opening another app.",
      "You can pause, skip, or say 'Stop the song' anytime.",
    ];
  }
  return [
    `${track.title} — ${track.artist}`,
    track.album ? `From the release "${track.album}"` : "Live preview stream active",
    "Signal locked through NOVA audio pipeline",
    "Balanced low-latency output · Windows WASAPI ready",
    "Lyrics sync follows playback progress in real time",
    "Use voice or media controls to skip, pause, or stop",
    "Click any track in Queue to switch immediately",
    "End of preview loop — search another track anytime",
  ];
}

/* ============================================================================
   1. MEDIA & LYRICS SUB-VIEW
   ============================================================================ */
interface MediaSubViewProps {
  currentTrack: SongTrack | null;
  isTrackPlaying: boolean;
  trackProgress: number;
  songResults: SongTrack[];
  onPlayTrack: (track: SongTrack) => void;
  onTogglePlayPause: () => void;
  onStopTrack: () => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onSearchSongsDirect: (query: string) => Promise<void>;
}

export const MediaSubView: React.FC<MediaSubViewProps> = ({
  currentTrack,
  isTrackPlaying,
  trackProgress,
  songResults,
  onPlayTrack,
  onTogglePlayPause,
  onStopTrack,
  onNextTrack,
  onPrevTrack,
  onSearchSongsDirect,
}) => {
  const [rightTab, setRightTab] = useState<"lyrics" | "queue">("lyrics");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const lyrics = useMemo(() => buildSyncedLyrics(currentTrack), [currentTrack]);
  const activeLyricIndex = currentTrack
    ? Math.min(lyrics.length - 1, Math.floor((trackProgress / 100) * lyrics.length))
    : 0;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      await onSearchSongsDirect(q);
      setRightTab("queue");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-12">
      {/* Left: Large Album Art + Playback Controls */}
      <div className="flex flex-col justify-between gap-3 sm:col-span-5">
        <div className="flex items-center gap-3">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-br from-slate-800 via-slate-900 to-black shadow-lg">
            {currentTrack?.artworkUrl ? (
              <img
                src={currentTrack.artworkUrl}
                alt={`${currentTrack.title} artwork`}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <Music2 className="h-7 w-7 text-slate-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold text-white">
              {currentTrack ? currentTrack.title : "Nothing Playing"}
            </p>
            <p className="truncate text-xs text-slate-400">
              {currentTrack ? currentTrack.artist : "Search a song below"}
            </p>
            {currentTrack?.album && (
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{currentTrack.album}</p>
            )}
          </div>
        </div>

        {/* Scrubber Bar */}
        <div className="space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              style={{ width: `${Math.min(100, Math.max(0, trackProgress))}%` }}
              className="h-full rounded-full bg-emerald-400 transition-[width] duration-200"
            />
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] text-slate-500 tabular-nums">
            <span>{currentTrack ? `${Math.round((trackProgress / 100) * 30)}s` : "0:00"}</span>
            <span>{currentTrack ? "0:30" : "—"}</span>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onPrevTrack}
            aria-label="Previous track"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={
              currentTrack
                ? onTogglePlayPause
                : () => {
                    if (songResults.length > 0) {
                      onPlayTrack(songResults[0]);
                    } else {
                      void onSearchSongsDirect("Blinding Lights");
                    }
                  }
            }
            aria-label={isTrackPlaying ? "Pause" : "Play"}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#0b0e14] transition-transform hover:scale-105"
          >
            {isTrackPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 translate-x-[0.5px]" />
            )}
          </button>
          <button
            type="button"
            onClick={onNextTrack}
            aria-label="Next track"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          {currentTrack && (
            <button
              type="button"
              onClick={onStopTrack}
              aria-label="Stop playback"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
            >
              <Square className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Inline Direct Song Search */}
        <form
          onSubmit={handleSearch}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1 focus-within:border-white/25"
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search any song..."
            className="h-6 min-w-0 flex-1 bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="rounded-md bg-white/12 px-2 py-0.5 text-[11px] font-medium text-slate-200 transition-colors hover:bg-white/20 disabled:opacity-40"
          >
            {searching ? "..." : "Find"}
          </button>
        </form>
      </div>

      {/* Right: Synced Lyrics / Queue Switcher */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] sm:col-span-7">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
          <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-0.5">
            <button
              type="button"
              onClick={() => setRightTab("lyrics")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                rightTab === "lyrics"
                  ? "bg-white/14 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Synced Lyrics
            </button>
            <button
              type="button"
              onClick={() => setRightTab("queue")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                rightTab === "queue"
                  ? "bg-white/14 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Queue ({songResults.length})
            </button>
          </div>
          <span className="font-mono text-[10px] text-slate-500">
            {isTrackPlaying ? "Playing" : "Standby"}
          </span>
        </div>

        <div className="h-[192px] overflow-y-auto p-3">
          {rightTab === "lyrics" ? (
            <div className="space-y-2">
              {lyrics.map((line, i) => (
                <p
                  key={i}
                  className={`text-xs leading-relaxed transition-colors ${
                    i === activeLyricIndex && currentTrack
                      ? "font-semibold text-white"
                      : i < activeLyricIndex && currentTrack
                      ? "text-slate-400"
                      : "text-slate-500"
                  }`}
                >
                  {line}
                </p>
              ))}
            </div>
          ) : songResults.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-xs text-slate-400">
              <p>Queue is empty.</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Search for an artist or song on the left to load tracks.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {songResults.map((track) => {
                const isCurrent = currentTrack?.id === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => onPlayTrack(track)}
                    className="flex w-full items-center justify-between gap-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-white/10 bg-slate-900">
                        {track.artworkUrl ? (
                          <img
                            src={track.artworkUrl}
                            alt={track.title}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Music2 className="m-2 h-4 w-4 text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p
                          className={`truncate text-xs font-medium ${
                            isCurrent ? "text-emerald-300" : "text-slate-200"
                          }`}
                        >
                          {track.title}
                        </p>
                        <p className="truncate text-[11px] text-slate-400">{track.artist}</p>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400">
                      {isCurrent && isTrackPlaying ? "Playing" : "Play"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   2. SYSTEM MONITOR SUB-VIEW
   ============================================================================ */
interface SystemMonitorSubViewProps {
  telemetry: TelemetrySnapshot;
  apps: DesktopApp[];
  onOpenAppWindow: (appId: string) => void;
  onCloseAppWindow: (appId: string) => void;
  onAttemptProtectedProcess: (processName: string) => void;
}

export const SystemMonitorSubView: React.FC<SystemMonitorSubViewProps> = ({
  telemetry,
  apps,
  onOpenAppWindow,
  onCloseAppWindow,
  onAttemptProtectedProcess,
}) => {
  const sparklinePoints = useMemo(() => {
    const pts = telemetry.cpuHistory;
    if (pts.length < 2) return "";
    return pts
      .map((val, idx) => {
        const x = (idx / (pts.length - 1)) * 180;
        const y = 38 - (Math.min(100, Math.max(0, val)) / 100) * 34;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [telemetry.cpuHistory]);

  return (
    <div className="space-y-3">
      {/* Top 3 Live Telemetry Metrics */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {/* CPU Sparkline */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-slate-400">CPU Load</span>
            <span className="font-mono text-sm font-semibold text-emerald-300 tabular-nums">
              {telemetry.cpuCurrent}%
            </span>
          </div>
          <svg viewBox="0 0 180 42" className="mt-2 h-9 w-full overflow-visible">
            <polyline
              fill="none"
              stroke="#34D399"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={sparklinePoints}
            />
          </svg>
        </div>

        {/* Memory Bar */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-slate-400">Memory</span>
            <span className="font-mono text-sm font-semibold text-sky-300 tabular-nums">
              {telemetry.ramPercent}%
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                style={{ width: `${telemetry.ramPercent}%` }}
                className="h-full rounded-full bg-sky-400 transition-[width] duration-500"
              />
            </div>
            <p className="font-mono text-[10px] text-slate-400 tabular-nums">
              {telemetry.ramUsedGb.toFixed(1)} / {telemetry.ramTotalGb} GB DDR5
            </p>
          </div>
        </div>

        {/* Network Throughput */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
          <span className="text-[11px] text-slate-400">Network</span>
          <div className="mt-2 space-y-1 font-mono text-xs tabular-nums">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Down</span>
              <span className="text-slate-100">{telemetry.netDownMbps.toFixed(1)} MB/s</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Up</span>
              <span className="text-slate-300">{telemetry.netUpMbps.toFixed(1)} MB/s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Apps & Protected Processes Table */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2 text-[11px] text-slate-400">
          <span className="font-medium text-slate-200">Top Apps &amp; Protected Processes</span>
          <span className="font-mono text-[10px] text-slate-500">
            {apps.filter((a) => a.isOpen).length} running · shell=False
          </span>
        </div>
        <div className="max-h-[152px] divide-y divide-white/[0.06] overflow-y-auto">
          {apps.map((app) => (
            <div
              key={app.id}
              className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-white/[0.03]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-100">{app.name}</p>
                <p className="font-mono text-[10px] text-slate-400">{app.processName}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {app.isOpen ? "Active" : "Stopped"}
                </span>
                {app.isOpen ? (
                  <button
                    type="button"
                    onClick={() => onCloseAppWindow(app.id)}
                    className="rounded-lg border border-rose-400/25 bg-rose-500/12 px-2.5 py-1 text-[11px] font-medium text-rose-200 transition-colors hover:bg-rose-500/22"
                  >
                    Close
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenAppWindow(app.id)}
                    className="rounded-lg border border-white/12 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:bg-white/14"
                  >
                    Open
                  </button>
                )}
              </div>
            </div>
          ))}

          {PROTECTED_PROCS.map((proc) => (
            <div
              key={proc.processName}
              className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-white/[0.02]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-300">{proc.name}</p>
                <p className="font-mono text-[10px] text-slate-500">
                  {proc.processName} · {proc.cpu}% CPU · {proc.memMb} MB
                </p>
              </div>
              <button
                type="button"
                onClick={() => onAttemptProtectedProcess(proc.processName)}
                title="Critical Windows process protected from termination"
                className="flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-slate-400 transition-colors hover:border-amber-400/30 hover:text-amber-200"
              >
                <ShieldCheck className="h-3 w-3 text-emerald-400" />
                <span>Protected</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   3. CALENDAR SUB-VIEW
   ============================================================================ */
interface CalendarSubViewProps {
  reminders: CalendarReminder[];
  onAddReminder: (dateKey: string, text: string) => void;
  onToggleReminder: (id: string) => void;
  onDeleteReminder: (id: string) => void;
}

export const CalendarSubView: React.FC<CalendarSubViewProps> = ({
  reminders,
  onAddReminder,
  onToggleReminder,
  onDeleteReminder,
}) => {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [newReminder, setNewReminder] = useState("");

  const formatKey = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const selectedKey = formatKey(viewYear, viewMonth, selectedDay);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });

  const dayReminders = reminders.filter((r) => r.dateKey === selectedKey);
  const reminderDateSet = useMemo(() => new Set(reminders.map((r) => r.dateKey)), [reminders]);

  const shiftMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setSelectedDay(1);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newReminder.trim();
    if (!clean) return;
    onAddReminder(selectedKey, clean);
    setNewReminder("");
  };

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-12">
      {/* Left: Interactive Month Grid */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 sm:col-span-6">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display text-xs font-semibold text-white">{monthLabel}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <span key={d} className="py-0.5 font-medium">
              {d}
            </span>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1 text-center font-mono text-[11px] tabular-nums">
          {Array.from({ length: firstWeekday }).map((_, idx) => (
            <span key={`pad-${idx}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const key = formatKey(viewYear, viewMonth, day);
            const isSelected = day === selectedDay;
            const isToday =
              day === today.getDate() &&
              viewMonth === today.getMonth() &&
              viewYear === today.getFullYear();
            const hasEvents = reminderDateSet.has(key);

            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDay(day)}
                className={`relative flex h-7 flex-col items-center justify-center rounded-lg transition-colors ${
                  isSelected
                    ? "bg-white font-semibold text-[#0b0e14]"
                    : isToday
                    ? "border border-emerald-400/50 text-emerald-300 hover:bg-white/10"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                <span>{day}</span>
                {hasEvents && (
                  <span
                    className={`mt-0.5 h-[2px] w-2.5 rounded-full ${
                      isSelected ? "bg-[#0b0e14]" : "bg-emerald-400"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Selected Day Reminders */}
      <div className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 sm:col-span-6">
        <div>
          <div className="flex items-center justify-between border-b border-white/[0.07] pb-2">
            <span className="font-display text-xs font-semibold text-white">
              {new Date(viewYear, viewMonth, selectedDay).toLocaleDateString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="font-mono text-[10px] text-slate-400 tabular-nums">
              {dayReminders.length} {dayReminders.length === 1 ? "item" : "items"}
            </span>
          </div>

          <div className="mt-2 h-[142px] space-y-1.5 overflow-y-auto">
            {dayReminders.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No reminders for this date.
              </p>
            ) : (
              dayReminders.map((rem) => (
                <div
                  key={rem.id}
                  className="group flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => onToggleReminder(rem.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className={`h-3.5 w-3.5 shrink-0 rounded border transition-colors ${
                        rem.done
                          ? "border-emerald-400 bg-emerald-400/25"
                          : "border-white/25"
                      }`}
                    />
                    <span
                      className={`truncate ${
                        rem.done ? "text-slate-500 line-through" : "text-slate-200"
                      }`}
                    >
                      {rem.text}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteReminder(rem.id)}
                    aria-label="Delete reminder"
                    className="text-slate-500 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-1.5">
          <input
            type="text"
            value={newReminder}
            onChange={(e) => setNewReminder(e.target.value)}
            placeholder="Add new reminder"
            className="h-8 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newReminder.trim()}
            aria-label="Add reminder"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-[#0b0e14] transition-opacity disabled:opacity-35"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};

/* ============================================================================
   4. NOTES SUB-VIEW
   ============================================================================ */
interface NotesSubViewProps {
  notes: NotchNote[];
  activeNoteId: string;
  onSelectNote: (id: string) => void;
  onCreateNote: () => void;
  onUpdateNote: (id: string, content: string) => void;
  onDeleteNote: (id: string) => void;
}

export const NotesSubView: React.FC<NotesSubViewProps> = ({
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
}) => {
  const activeNote = notes.find((n) => n.id === activeNoteId) ?? notes[0] ?? null;

  const getTitle = (content: string) => {
    const firstLine = content.split("\n")[0]?.trim();
    return firstLine || "Untitled Note";
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
      {/* Left Sidebar: Note List */}
      <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 sm:col-span-4">
        <div className="mb-1.5 flex items-center justify-between px-1.5">
          <span className="text-[11px] font-medium text-slate-400">All Notes</span>
          <button
            type="button"
            onClick={onCreateNote}
            aria-label="Create note"
            className="flex h-6 items-center gap-1 rounded-md bg-white/10 px-2 text-[11px] font-medium text-white hover:bg-white/18"
          >
            <Plus className="h-3 w-3" />
            <span>New</span>
          </button>
        </div>

        <div className="h-[192px] space-y-1 overflow-y-auto">
          {notes.map((note) => {
            const active = activeNote?.id === note.id;
            return (
              <div
                key={note.id}
                className={`group flex items-center justify-between gap-1 rounded-xl px-2.5 py-2 transition-colors ${
                  active
                    ? "bg-white/12 text-white"
                    : "text-slate-300 hover:bg-white/[0.05]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectNote(note.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-xs font-medium">{getTitle(note.content)}</p>
                  <p className="font-mono text-[10px] text-slate-500">{note.updatedAt}</p>
                </button>
                {notes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteNote(note.id)}
                    aria-label="Delete note"
                    className="text-slate-500 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Editor */}
      <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 sm:col-span-8">
        {activeNote ? (
          <>
            <textarea
              value={activeNote.content}
              onChange={(e) => onUpdateNote(activeNote.id, e.target.value)}
              placeholder="Start typing. The first line is the title."
              className="h-[186px] w-full resize-none bg-transparent text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between border-t border-white/[0.07] pt-2 font-mono text-[10px] text-slate-500 tabular-nums">
              <span>{activeNote.content.trim() ? activeNote.content.trim().split(/\s+/).length : 0} words</span>
              <span>Saved locally · {activeNote.updatedAt}</span>
            </div>
          </>
        ) : (
          <div className="flex h-[200px] items-center justify-center text-xs text-slate-500">
            Create a note to begin writing.
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
   5. NOVA AI & SECURITY SUB-VIEW
   ============================================================================ */
interface NovaAISubViewProps {
  assistantLabel: string;
  orbState: "idle" | "listening" | "thinking" | "speaking" | "locked";
  liveStatus: "disconnected" | "connecting" | "live" | "speaking";
  liveInputTranscript: string;
  liveOutputTranscript: string;
  inputValue: string;
  onInputChange: (val: string) => void;
  onSubmitCommand: (text: string) => void;
  onToggleLiveVoice: () => void;
  lastReply: string;
  lastResolvedRef: string;
  lastSources: GroundingSource[];
  lastError: string | null;
  retryableError: boolean;
  onRetryLastCommand: () => void;
  memoryCount: number;
  folders: VirtualFolder[];
  vault: VaultState;
  airMouseEnabled: boolean;
  onToggleAirMouse: () => void;
  onOpenVault: () => void;
  onLockWorkstation: () => void;
}

export const NovaAISubView: React.FC<NovaAISubViewProps> = ({
  assistantLabel,
  orbState,
  liveStatus,
  liveInputTranscript,
  liveOutputTranscript,
  inputValue,
  onInputChange,
  onSubmitCommand,
  onToggleLiveVoice,
  lastReply,
  lastResolvedRef,
  lastSources,
  lastError,
  retryableError,
  onRetryLastCommand,
  memoryCount,
  folders,
  vault,
  airMouseEnabled,
  onToggleAirMouse,
  onOpenVault,
  onLockWorkstation,
}) => {
  const isLiveActive = liveStatus !== "disconnected";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputValue.trim();
    if (!clean) return;
    onSubmitCommand(clean);
  };

  return (
    <div className="space-y-3">
      {/* Conversational AI & TTS Talk-Back Bubble */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
        {lastError ? (
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] leading-relaxed text-rose-300">{lastError}</p>
            {retryableError && (
              <button
                type="button"
                onClick={onRetryLastCommand}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-rose-500/25"
              >
                <RotateCw className="h-3 w-3" />
                Retry
              </button>
            )}
          </div>
        ) : isLiveActive ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-emerald-300">
              {liveStatus === "connecting"
                ? "Connecting Gemini 3.8 Live voice..."
                : "Live Voice active — speak naturally or interrupt anytime"}
            </p>
            {liveInputTranscript && (
              <p className="text-xs text-slate-400">
                You · <span className="text-slate-200">{liveInputTranscript}</span>
              </p>
            )}
            {liveOutputTranscript && (
              <p className="text-[13px] leading-relaxed text-white">{liveOutputTranscript}</p>
            )}
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-slate-100">{lastReply}</p>
            {lastResolvedRef && (
              <p className="mt-1.5 font-mono text-[11px] text-slate-400">
                Memory · <span className="text-slate-200">{lastResolvedRef}</span>
              </p>
            )}
            {lastSources.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/[0.06] pt-2 text-[11px] text-slate-400">
                <span className="text-slate-500">Sources</span>
                {lastSources.map((src, i) => (
                  <React.Fragment key={src.uri}>
                    <span aria-hidden="true" className="text-slate-600">
                      ·
                    </span>
                    <a
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-[156px] items-center gap-0.5 text-slate-200 hover:text-white hover:underline"
                    >
                      <span className="truncate">{src.title || `Source ${i + 1}`}</span>
                      <ArrowUpRight className="h-3 w-3 shrink-0 text-slate-400" />
                    </a>
                  </React.Fragment>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Prompt Input + Live Mic Row */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 pl-3.5 focus-within:border-white/25"
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={`Ask ${assistantLabel} anything...`}
          className="h-8 flex-1 bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onToggleLiveVoice}
          aria-label={isLiveActive ? "End live voice" : "Start live voice"}
          className={`flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
            isLiveActive
              ? "border border-rose-400/35 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30"
              : "border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/12"
          }`}
        >
          {isLiveActive ? <PhoneOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          <span>{isLiveActive ? "End" : "Voice"}</span>
        </button>
        <button
          type="submit"
          disabled={!inputValue.trim() || orbState === "thinking"}
          aria-label="Send prompt"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-[#0b0e14] transition-opacity hover:bg-slate-100 disabled:opacity-35"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>

      {/* Sandboxed Folders, Air-Mouse & 2FA Vault Quick Strip */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-slate-200">
                Sandboxed Folders ({folders.length})
              </p>
              <p className="truncate text-[10px] text-slate-500">
                Desktop · Documents · Downloads
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSubmitCommand("Create folder Sprint Notes on Desktop")}
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-slate-200 hover:bg-white/12"
          >
            + Folder
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-slate-200">
                2FA Vault · {vault.voiceprintEnrolled ? "Armed" : "Setup"}
              </p>
              <p className="truncate font-mono text-[10px] text-slate-500 tabular-nums">
                Memory {memoryCount}/{MEMORY_WINDOW_SIZE}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onToggleAirMouse}
              title="Toggle MediaPipe Air-Mouse"
              className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
                airMouseEnabled
                  ? "border-sky-400/40 bg-sky-500/20 text-sky-200"
                  : "border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/12"
              }`}
            >
              <Hand className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onOpenVault}
              className="h-7 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-[10px] font-medium text-slate-200 hover:bg-white/12"
            >
              Vault
            </button>
            <button
              type="button"
              onClick={onLockWorkstation}
              aria-label="Lock workstation"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
            >
              <Lock className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
