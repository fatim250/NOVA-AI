import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ChevronUp,
  Coffee,
  FolderKanban,
  Lock,
  Mic,
  Minus,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  StickyNote,
} from "lucide-react";
import type {
  DesktopApp,
  GroundingSource,
  SongTrack,
  VaultState,
  VirtualFolder,
} from "../types/notch";
import {
  CalendarSubView,
  MediaSubView,
  NotesSubView,
  NovaAISubView,
  SystemMonitorSubView,
  type CalendarReminder,
  type NotchNote,
  type NotchSubView,
  type TelemetrySnapshot,
} from "./NotchBentoSubViews";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "locked";
export type LiveVoiceStatus = "disconnected" | "connecting" | "live" | "speaking";

interface DynamicNotchProps {
  assistantName: string;
  browserAutoHide: boolean;
  expanded: boolean;
  activeView: NotchSubView;
  onChangeView: (view: NotchSubView) => void;
  onToggleExpanded: (next?: boolean) => void;
  orbState: OrbState;
  liveStatus: LiveVoiceStatus;
  liveInputTranscript: string;
  liveOutputTranscript: string;
  isLocked: boolean;
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
  isPatrolling: boolean;
  onToggleKeepAwake: () => void;
  airMouseEnabled: boolean;
  onToggleAirMouse: () => void;
  apps: DesktopApp[];
  folders: VirtualFolder[];
  vault: VaultState;
  onOpenAppWindow: (appId: string) => void;
  onCloseAppWindow: (appId: string) => void;
  onAttemptProtectedProcess: (procName: string) => void;
  onOpenVault: () => void;
  onLockWorkstation: () => void;
}

export type AmbientThemeId = "aurora" | "rose" | "emerald" | "solar" | "auto";

interface AmbientPalette {
  id: string;
  label: string;
  outerGlow: string;
  innerGlow: string;
  borderAccent: string;
  topHighlight: string;
  orbHalo: string;
  orbCore: string;
  orbRing: string;
  eqColorA: string;
  eqColorB: string;
}

const AMBIENT_PALETTES: Record<
  "aurora" | "rose" | "emerald" | "solar" | "teal" | "crimson",
  AmbientPalette
> = {
  aurora: {
    id: "aurora",
    label: "Aurora Cyan-Violet",
    outerGlow:
      "radial-gradient(62% 90% at 22% 18%, rgba(34,211,238,0.44), transparent 72%), radial-gradient(66% 90% at 82% 82%, rgba(139,92,246,0.46), transparent 72%)",
    innerGlow:
      "radial-gradient(65% 95% at 14% 0%, rgba(34,211,238,0.18), transparent 62%), radial-gradient(65% 95% at 88% 100%, rgba(139,92,246,0.22), transparent 64%)",
    borderAccent: "rgba(103, 232, 249, 0.34)",
    topHighlight:
      "linear-gradient(90deg, transparent, rgba(103,232,249,0.72), rgba(196,181,253,0.72), transparent)",
    orbHalo: "rgba(56, 189, 248, 0.42)",
    orbCore:
      "radial-gradient(circle at 34% 30%, #FFFFFF 0%, #67E8F9 40%, #8B5CF6 78%, #1E1B4B 100%)",
    orbRing:
      "conic-gradient(from 0deg, rgba(103,232,249,0.88), rgba(139,92,246,0.34), rgba(255,255,255,0.06), rgba(103,232,249,0.88))",
    eqColorA: "#67E8F9",
    eqColorB: "#C4B5FD",
  },
  rose: {
    id: "rose",
    label: "Rose-Magenta",
    outerGlow:
      "radial-gradient(62% 90% at 22% 18%, rgba(251,113,133,0.46), transparent 72%), radial-gradient(66% 90% at 82% 82%, rgba(217,70,239,0.42), transparent 72%)",
    innerGlow:
      "radial-gradient(65% 95% at 14% 0%, rgba(251,113,133,0.19), transparent 62%), radial-gradient(65% 95% at 88% 100%, rgba(217,70,239,0.20), transparent 64%)",
    borderAccent: "rgba(251, 113, 133, 0.38)",
    topHighlight:
      "linear-gradient(90deg, transparent, rgba(253,164,175,0.75), rgba(240,171,252,0.72), transparent)",
    orbHalo: "rgba(244, 114, 182, 0.42)",
    orbCore:
      "radial-gradient(circle at 34% 30%, #FFF1F2 0%, #FDA4AF 40%, #D946EF 78%, #3B0764 100%)",
    orbRing:
      "conic-gradient(from 0deg, rgba(253,164,175,0.9), rgba(217,70,239,0.34), rgba(255,255,255,0.06), rgba(253,164,175,0.9))",
    eqColorA: "#FDA4AF",
    eqColorB: "#F0ABFC",
  },
  emerald: {
    id: "emerald",
    label: "Emerald Pulse",
    outerGlow:
      "radial-gradient(62% 90% at 22% 18%, rgba(52,211,153,0.44), transparent 72%), radial-gradient(66% 90% at 82% 82%, rgba(20,184,166,0.40), transparent 72%)",
    innerGlow:
      "radial-gradient(65% 95% at 14% 0%, rgba(52,211,153,0.18), transparent 62%), radial-gradient(65% 95% at 88% 100%, rgba(20,184,166,0.18), transparent 64%)",
    borderAccent: "rgba(52, 211, 153, 0.36)",
    topHighlight:
      "linear-gradient(90deg, transparent, rgba(110,231,183,0.72), rgba(94,234,212,0.70), transparent)",
    orbHalo: "rgba(52, 211, 153, 0.40)",
    orbCore:
      "radial-gradient(circle at 34% 30%, #ECFDF5 0%, #6EE7B7 42%, #0D9488 80%, #064E3B 100%)",
    orbRing:
      "conic-gradient(from 0deg, rgba(110,231,183,0.9), rgba(20,184,166,0.32), rgba(255,255,255,0.06), rgba(110,231,183,0.9))",
    eqColorA: "#6EE7B7",
    eqColorB: "#5EEAD4",
  },
  solar: {
    id: "solar",
    label: "Solar Amber-Gold",
    outerGlow:
      "radial-gradient(62% 90% at 22% 18%, rgba(251,191,36,0.42), transparent 72%), radial-gradient(66% 90% at 82% 82%, rgba(249,115,22,0.40), transparent 72%)",
    innerGlow:
      "radial-gradient(65% 95% at 14% 0%, rgba(251,191,36,0.17), transparent 62%), radial-gradient(65% 95% at 88% 100%, rgba(249,115,22,0.18), transparent 64%)",
    borderAccent: "rgba(251, 191, 36, 0.38)",
    topHighlight:
      "linear-gradient(90deg, transparent, rgba(253,224,71,0.72), rgba(253,186,116,0.72), transparent)",
    orbHalo: "rgba(251, 191, 36, 0.40)",
    orbCore:
      "radial-gradient(circle at 34% 30%, #FFFBEB 0%, #FDE047 42%, #EA580C 80%, #431407 100%)",
    orbRing:
      "conic-gradient(from 0deg, rgba(253,224,71,0.9), rgba(249,115,22,0.34), rgba(255,255,255,0.06), rgba(253,224,71,0.9))",
    eqColorA: "#FDE047",
    eqColorB: "#FDBA74",
  },
  teal: {
    id: "teal",
    label: "Listening Teal",
    outerGlow:
      "radial-gradient(62% 90% at 22% 18%, rgba(45,212,191,0.48), transparent 72%), radial-gradient(66% 90% at 82% 82%, rgba(14,165,233,0.42), transparent 72%)",
    innerGlow:
      "radial-gradient(65% 95% at 14% 0%, rgba(45,212,191,0.20), transparent 62%), radial-gradient(65% 95% at 88% 100%, rgba(14,165,233,0.18), transparent 64%)",
    borderAccent: "rgba(45, 212, 191, 0.42)",
    topHighlight:
      "linear-gradient(90deg, transparent, rgba(94,234,212,0.8), rgba(125,211,252,0.75), transparent)",
    orbHalo: "rgba(45, 212, 191, 0.48)",
    orbCore:
      "radial-gradient(circle at 34% 30%, #F0FDFA 0%, #5EEAD4 42%, #0284C7 80%, #082F49 100%)",
    orbRing:
      "conic-gradient(from 0deg, rgba(94,234,212,0.92), rgba(56,189,248,0.34), rgba(255,255,255,0.06), rgba(94,234,212,0.92))",
    eqColorA: "#5EEAD4",
    eqColorB: "#7DD3FC",
  },
  crimson: {
    id: "crimson",
    label: "Security Alert Crimson",
    outerGlow:
      "radial-gradient(62% 90% at 22% 18%, rgba(244,63,94,0.48), transparent 72%), radial-gradient(66% 90% at 82% 82%, rgba(220,38,38,0.42), transparent 72%)",
    innerGlow:
      "radial-gradient(65% 95% at 14% 0%, rgba(244,63,94,0.20), transparent 62%), radial-gradient(65% 95% at 88% 100%, rgba(185,28,28,0.19), transparent 64%)",
    borderAccent: "rgba(251, 113, 133, 0.46)",
    topHighlight:
      "linear-gradient(90deg, transparent, rgba(253,164,175,0.8), rgba(248,113,113,0.75), transparent)",
    orbHalo: "rgba(244, 63, 94, 0.46)",
    orbCore:
      "radial-gradient(circle at 34% 30%, #FFF1F2 0%, #FDA4AF 40%, #E11D48 78%, #4C0519 100%)",
    orbRing:
      "conic-gradient(from 0deg, rgba(253,164,175,0.92), rgba(225,29,72,0.36), rgba(255,255,255,0.06), rgba(253,164,175,0.92))",
    eqColorA: "#FDA4AF",
    eqColorB: "#F87171",
  },
};

const AUTO_CYCLE_KEYS: Array<"aurora" | "rose" | "emerald" | "solar"> = [
  "aurora",
  "rose",
  "emerald",
  "solar",
];

const ALL_PALETTE_KEYS: Array<"aurora" | "rose" | "emerald" | "solar" | "teal" | "crimson"> = [
  "aurora",
  "rose",
  "emerald",
  "solar",
  "teal",
  "crimson",
];

function pickTrackAmbientKey(track: SongTrack): "aurora" | "rose" | "emerald" | "solar" {
  const sig = `${track.title}-${track.artist}-${track.id}`;
  let hash = 0;
  for (let i = 0; i < sig.length; i += 1) {
    hash = (hash * 31 + sig.charCodeAt(i)) >>> 0;
  }
  const keys: Array<"aurora" | "rose" | "emerald" | "solar"> = ["rose", "aurora", "solar", "emerald"];
  return keys[hash % keys.length];
}

const OpticalIris: React.FC<{
  mode: "idle" | "live" | "thinking" | "speaking" | "locked" | "music";
  ambient: AmbientPalette;
  size?: "sm" | "md";
}> = ({ mode, ambient, size = "md" }) => {
  const outerClass = size === "sm" ? "h-[18px] w-[18px]" : "h-[20px] w-[20px]";
  const innerClass = size === "sm" ? "h-[11px] w-[11px]" : "h-[12px] w-[12px]";

  return (
    <span className={`relative flex ${outerClass} shrink-0 items-center justify-center`}>
      <span
        style={{ background: ambient.orbHalo }}
        className="iris-breathe absolute inset-[-4px] rounded-full blur-[6px] transition-[background] duration-500"
      />
      <span
        style={{ background: ambient.orbRing }}
        className={`${
          mode === "thinking" || mode === "speaking" || mode === "live"
            ? "iris-orbit-fast"
            : "iris-orbit"
        } absolute inset-0 rounded-full p-[1.5px] transition-[background] duration-500`}
      >
        <span className="block h-full w-full rounded-full bg-[#12141c]" />
      </span>
      <span
        style={{ background: ambient.orbCore }}
        className={`iris-breathe relative ${innerClass} rounded-full shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.65)] transition-[background] duration-500`}
      />
    </span>
  );
};

const MiniSpectrumBars: React.FC<{ active: boolean; colorA: string; colorB: string }> = ({
  active,
  colorA,
  colorB,
}) => (
  <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
    <span
      style={{ backgroundColor: colorA }}
      className={`w-[2px] origin-bottom rounded-full transition-colors duration-500 ${
        active ? "eq-bar-1 h-3" : "h-1 opacity-35"
      }`}
    />
    <span
      style={{ backgroundColor: colorB }}
      className={`w-[2px] origin-bottom rounded-full transition-colors duration-500 ${
        active ? "eq-bar-2 h-3" : "h-1.5 opacity-35"
      }`}
    />
    <span
      style={{ backgroundColor: colorA }}
      className={`w-[2px] origin-bottom rounded-full transition-colors duration-500 ${
        active ? "eq-bar-3 h-3" : "h-1 opacity-35"
      }`}
    />
  </span>
);

const VIEW_TITLES: Record<Exclude<NotchSubView, "bento">, string> = {
  media: "Media & Lyrics",
  monitor: "System Monitor",
  calendar: "Calendar",
  notes: "Notes",
  ai: "NOVA AI & Security",
};

const INITIAL_NOTES: NotchNote[] = [
  {
    id: "note-1",
    content: "Q4 Sprint Notes\nReview WindowsNotch 2FA voiceprint threshold & test Chrome auto-hide.",
    updatedAt: "Today",
  },
  {
    id: "note-2",
    content: "Shortcuts\nSay 'Call yourself Nova', 'Play Blinding Lights', or 'Create folder Invoices'.",
    updatedAt: "Yesterday",
  },
];

export const DynamicNotch: React.FC<DynamicNotchProps> = ({
  assistantName,
  browserAutoHide,
  expanded,
  activeView,
  onChangeView,
  onToggleExpanded,
  orbState,
  liveStatus,
  liveInputTranscript,
  liveOutputTranscript,
  isLocked,
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
  isPatrolling,
  onToggleKeepAwake,
  airMouseEnabled,
  onToggleAirMouse,
  apps,
  folders,
  vault,
  onOpenAppWindow,
  onCloseAppWindow,
  onAttemptProtectedProcess,
  onOpenVault,
  onLockWorkstation,
}) => {
  const [bezelHovered, setBezelHovered] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [autoCycleIdx, setAutoCycleIdx] = useState(0);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);

  // Automatically morph ambient aurora colors continuously without user interaction
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const id = window.setInterval(() => {
      setAutoCycleIdx((prev) => (prev + 1) % AUTO_CYCLE_KEYS.length);
    }, 4200);
    return () => window.clearInterval(id);
  }, []);

  // Focus Timer State (25:00 default)
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [focusSecondsLeft, setFocusSecondsLeft] = useState(25 * 60);
  const [focusRunning, setFocusRunning] = useState(false);

  // Quick Notes State
  const [notes, setNotes] = useState<NotchNote[]>(INITIAL_NOTES);
  const [activeNoteId, setActiveNoteId] = useState<string>(INITIAL_NOTES[0].id);

  // Calendar Reminders State (seeded for today)
  const todayObj = useMemo(() => new Date(), []);
  const todayKey = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(todayObj.getDate()).padStart(2, "0")}`;
  const [reminders, setReminders] = useState<CalendarReminder[]>([
    {
      id: "rem-1",
      dateKey: todayKey,
      text: "Verify Session-0 Named Pipe DACL rules",
      time: "14:00",
      done: false,
    },
    {
      id: "rem-2",
      dateKey: todayKey,
      text: "Ship WindowsNotch Pro desktop build",
      time: "17:30",
      done: false,
    },
  ]);

  // Live Telemetry State (reactive to open apps + patrol/voice load)
  const openAppCount = apps.filter((a) => a.isOpen).length;
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>({
    cpuHistory: [18, 21, 19, 24, 22, 26, 23, 21, 25, 22, 20, 24],
    cpuCurrent: 24,
    ramPercent: 46,
    ramUsedGb: 14.7,
    ramTotalGb: 32,
    netDownMbps: 18.4,
    netUpMbps: 3.2,
  });

  // Tick Focus Timer
  useEffect(() => {
    if (!focusRunning) return;
    const id = window.setInterval(() => {
      setFocusSecondsLeft((prev) => {
        if (prev <= 1) {
          setFocusRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [focusRunning]);

  // Tick Live Telemetry
  useEffect(() => {
    const id = window.setInterval(() => {
      const baseCpu = 12 + openAppCount * 6 + (isPatrolling ? 3 : 0) + (liveStatus !== "disconnected" ? 7 : 0);
      const nextCpu = Math.min(96, Math.max(6, Math.round(baseCpu + (Math.random() * 10 - 5))));
      const ramPct = Math.min(92, Math.max(28, 36 + openAppCount * 5 + Math.round(Math.random() * 3)));
      setTelemetry((prev) => ({
        cpuHistory: [...prev.cpuHistory.slice(-15), nextCpu],
        cpuCurrent: nextCpu,
        ramPercent: ramPct,
        ramUsedGb: Number(((ramPct / 100) * 32).toFixed(1)),
        ramTotalGb: 32,
        netDownMbps: Number((Math.max(0.4, (isTrackPlaying ? 12.6 : 4.2) + Math.random() * 8)).toFixed(1)),
        netUpMbps: Number((Math.max(0.2, 1.1 + Math.random() * 2.4)).toFixed(1)),
      }));
    }, 1600);
    return () => window.clearInterval(id);
  }, [openAppCount, isPatrolling, liveStatus, isTrackPlaying]);

  useEffect(() => {
    if (!expanded) {
      setPinnedOpen(false);
    }
  }, [expanded]);

  useEffect(() => {
    return () => {
      if (hoverOpenTimerRef.current) window.clearTimeout(hoverOpenTimerRef.current);
      if (hoverCloseTimerRef.current) window.clearTimeout(hoverCloseTimerRef.current);
    };
  }, []);

  const isLiveActive = liveStatus !== "disconnected";
  const isAudioActive = isTrackPlaying || isLiveActive || orbState === "speaking";

  // Automatically vanish while working inside Chrome/Edge unless expanded, active, or bezel hovered
  const isInvisibleForBrowser =
    browserAutoHide &&
    !expanded &&
    !bezelHovered &&
    !isLiveActive &&
    orbState !== "thinking" &&
    orbState !== "speaking";

  const irisMode = (() => {
    if (liveStatus === "connecting" || orbState === "thinking") return "thinking" as const;
    if (liveStatus === "speaking" || orbState === "speaking") return "speaking" as const;
    if (liveStatus === "live" || orbState === "listening") return "live" as const;
    if (isLocked || orbState === "locked") return "locked" as const;
    if (currentTrack && isTrackPlaying) return "music" as const;
    return "idle" as const;
  })();

  // Automatically resolve active ambient palette (reactive to security/voice/music + continuous smooth cycling)
  const activeAmbientKey: "aurora" | "rose" | "emerald" | "solar" | "teal" | "crimson" = useMemo(() => {
    if (isLocked || orbState === "locked" || Boolean(lastError)) {
      return "crimson";
    }
    if (liveStatus === "live" || orbState === "listening") {
      return "teal";
    }
    if (currentTrack && isTrackPlaying) {
      return pickTrackAmbientKey(currentTrack);
    }
    return AUTO_CYCLE_KEYS[autoCycleIdx];
  }, [isLocked, orbState, lastError, liveStatus, currentTrack, isTrackPlaying, autoCycleIdx]);

  const activeAmbient: AmbientPalette = AMBIENT_PALETTES[activeAmbientKey];

  const cleanName = assistantName.trim();
  const displayName = cleanName || "NOVA AI";

  const collapsedStatusLabel = (() => {
    if (liveStatus === "connecting") return "Connecting...";
    if (liveStatus === "live") return "Listening";
    if (liveStatus === "speaking") return `${cleanName || "NOVA"} · Speaking`;
    if (orbState === "thinking") return "Thinking...";
    if (isLocked) return "Session-0 · Locked";
    if (currentTrack) return currentTrack.title;
    if (focusRunning) {
      const m = String(Math.floor(focusSecondsLeft / 60)).padStart(2, "0");
      const s = String(focusSecondsLeft % 60).padStart(2, "0");
      return `Focus · ${m}:${s}`;
    }
    return cleanName ? `${cleanName} · Armed` : "Armed";
  })();

  const handleCapsuleMouseEnter = () => {
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    if (!expanded && !isInvisibleForBrowser) {
      hoverOpenTimerRef.current = window.setTimeout(() => {
        onToggleExpanded(true);
      }, 180);
    }
  };

  const handleCapsuleMouseLeave = () => {
    setBezelHovered(false);
    if (hoverOpenTimerRef.current) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (expanded && !pinnedOpen && !isLiveActive && orbState !== "thinking" && activeView === "bento") {
      hoverCloseTimerRef.current = window.setTimeout(() => {
        onToggleExpanded(false);
      }, 260);
    }
  };

  const openSubView = (view: NotchSubView) => {
    setPinnedOpen(true);
    onChangeView(view);
    if (!expanded) onToggleExpanded(true);
  };

  // Focus timer ring math
  const focusTotalSec = Math.max(60, focusMinutes * 60);
  const focusRatio = focusSecondsLeft / focusTotalSec;
  const ringRadius = 26;
  const ringCirc = 2 * Math.PI * ringRadius;
  const ringOffset = ringCirc * (1 - focusRatio);
  const focusMM = String(Math.floor(focusSecondsLeft / 60)).padStart(2, "0");
  const focusSS = String(focusSecondsLeft % 60).padStart(2, "0");

  const adjustFocusMinutes = (delta: number) => {
    setFocusRunning(false);
    setFocusMinutes((prev) => {
      const next = Math.min(90, Math.max(5, prev + delta));
      setFocusSecondsLeft(next * 60);
      return next;
    });
  };

  // Mini CPU ring math for Bento tile
  const miniCpuRadius = 11;
  const miniCpuCirc = 2 * Math.PI * miniCpuRadius;
  const miniCpuOffset = miniCpuCirc * (1 - telemetry.cpuCurrent / 100);

  // Active note snippet for Bento Quick Notes card
  const activeNote = notes.find((n) => n.id === activeNoteId) ?? notes[0];
  const noteLines = (activeNote?.content ?? "").split("\n");
  const notePreviewTitle = noteLines[0]?.trim() || "Write something...";
  const notePreviewBody = noteLines.slice(1).join(" ").trim() || "Click to open quick notes";

  // Live Calendar day tile strings
  const monthShort = todayObj
    .toLocaleDateString("en-US", { month: "short" })
    .toUpperCase();
  const dayNum = todayObj.getDate();

  const capsuleWidth = expanded
    ? activeView === "bento"
      ? 720
      : 660
    : currentTrack
    ? 262
    : cleanName
    ? 228
    : 176;

  return (
    <>
      {/* Top-Edge Invisible Hot-Zone to smoothly reveal the assistant while working in Chrome/Edge */}
      {browserAutoHide && !expanded && (
        <div
          onMouseEnter={() => setBezelHovered(true)}
          onClick={() => {
            setBezelHovered(true);
            setPinnedOpen(true);
            onToggleExpanded(true);
          }}
          title="Hover top edge to reveal assistant"
          className="absolute inset-x-1/3 top-0 z-50 flex h-2.5 cursor-pointer items-start justify-center pt-[3px]"
        >
          <span
            className={`h-[3px] rounded-full transition-all duration-300 ${
              isInvisibleForBrowser
                ? "w-14 bg-white/30 hover:w-20 hover:bg-white/70"
                : "w-0 opacity-0"
            }`}
          />
        </div>
      )}

      <div
        onMouseLeave={handleCapsuleMouseLeave}
        className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-3"
      >
        <div className="relative flex max-w-full justify-center">
          {/* Smoothly Crossfading Automatic Ambient Aurora Halo behind the frosted glass capsule */}
          <motion.div
            aria-hidden="true"
            animate={
              isInvisibleForBrowser
                ? { opacity: 0, scale: 0.85 }
                : { opacity: expanded ? 0.95 : 0.68, scale: 1 }
            }
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            style={{ width: capsuleWidth }}
            className="pointer-events-none absolute -inset-x-5 -inset-y-3 max-w-full overflow-hidden rounded-[38px] blur-2xl"
          >
            {ALL_PALETTE_KEYS.map((key) => (
              <div
                key={`outer-${key}`}
                style={{ background: AMBIENT_PALETTES[key].outerGlow }}
                className={`absolute inset-0 transition-opacity duration-[1800ms] ease-in-out ${
                  activeAmbientKey === key ? "opacity-100" : "opacity-0"
                }`}
              />
            ))}
          </motion.div>

          <motion.div
            layout
            onMouseEnter={handleCapsuleMouseEnter}
            animate={
              isInvisibleForBrowser
                ? { opacity: 0, y: -26, scale: 0.92 }
                : { opacity: 1, y: 0, scale: 1 }
            }
            transition={{ type: "spring", stiffness: 440, damping: 34, mass: 0.72 }}
            style={{
              width: capsuleWidth,
              borderRadius: expanded ? 26 : 999,
              borderColor: activeAmbient.borderAccent,
            }}
            className={`relative max-w-full overflow-hidden border bg-[#12141c]/85 shadow-[0_24px_58px_-14px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl saturate-150 transition-[border-color] duration-[1600ms] ease-in-out ${
              isInvisibleForBrowser ? "pointer-events-none" : "pointer-events-auto"
            }`}
          >
            {/* Internal Automatic Aurora Wash smoothly crossfading inside the frosted glass */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {ALL_PALETTE_KEYS.map((key) => (
                <div
                  key={`inner-${key}`}
                  style={{ background: AMBIENT_PALETTES[key].innerGlow }}
                  className={`absolute inset-0 transition-opacity duration-[1800ms] ease-in-out ${
                    activeAmbientKey === key ? "opacity-100" : "opacity-0"
                  }`}
                />
              ))}
            </div>

            {/* Theme-Tinted Specular Top Edge */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-0 h-[1px]">
              {ALL_PALETTE_KEYS.map((key) => (
                <div
                  key={`rim-${key}`}
                  style={{ background: AMBIENT_PALETTES[key].topHighlight }}
                  className={`absolute inset-0 transition-opacity duration-[1600ms] ease-in-out ${
                    activeAmbientKey === key ? "opacity-100" : "opacity-0"
                  }`}
                />
              ))}
            </div>

            {/* ==================== COLLAPSED ULTRA-COMPACT IDLE PILL ==================== */}
            {!expanded && (
              <button
                type="button"
                onClick={() => {
                  setPinnedOpen(true);
                  onToggleExpanded(true);
                }}
                aria-label="Expand NOVA Bento hub"
                className="group relative z-10 flex h-[40px] w-full items-center justify-between gap-2.5 px-3 text-left focus-visible:outline-none"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <OpticalIris mode={irisMode} ambient={activeAmbient} size="sm" />
                  {currentTrack && (
                    <Music2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  )}
                  <span className="truncate font-display text-[12.5px] font-medium tracking-[-0.01em] text-slate-100 transition-colors group-hover:text-white">
                    {collapsedStatusLabel}
                  </span>
                </span>

                {isAudioActive && (
                  <MiniSpectrumBars
                    active={true}
                    colorA={activeAmbient.eqColorA}
                    colorB={activeAmbient.eqColorB}
                  />
                )}
              </button>
            )}

            {/* ==================== EXPANDED BENTO HUB OR SUB-VIEW ==================== */}
            <AnimatePresence mode="wait" initial={false}>
              {expanded && activeView === "bento" && (
                <motion.div
                  key="bento-hub"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="relative z-10 p-3.5"
                >
                  {/* Quiet Top Strip inside Bento Capsule */}
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <OpticalIris mode={irisMode} ambient={activeAmbient} size="sm" />
                      <span className="font-display text-xs font-semibold tracking-tight text-white">
                        {cleanName || "NOVA"}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-[11px] text-slate-400">
                        {isLocked
                          ? "Session-0 Locked"
                          : isPatrolling
                          ? "Keep-Awake Active"
                          : "Armed"}
                      </span>
                      {isAudioActive && (
                        <MiniSpectrumBars
                          active={true}
                          colorA={activeAmbient.eqColorA}
                          colorB={activeAmbient.eqColorB}
                        />
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openSubView("ai")}
                        className="rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-100 transition-colors hover:bg-white/14 hover:text-white"
                      >
                        Ask {cleanName || "NOVA"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPinnedOpen(false);
                          onToggleExpanded(false);
                        }}
                        aria-label="Collapse notch"
                        className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                {/* 3-COLUMN BENTO GRID */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                  {/* LEFT COLUMN: Focus Timer + Keep-Awake ("Coffee") Toggle */}
                  <div className="flex flex-col gap-2.5 sm:col-span-4">
                    {/* 1. Focus Timer Card */}
                    <div className="flex flex-1 flex-col justify-between rounded-[18px] border border-white/[0.08] bg-white/[0.035] p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-slate-400">Focus Timer</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => adjustFocusMinutes(-5)}
                            aria-label="Decrease focus duration"
                            className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.06] text-slate-300 hover:bg-white/14 hover:text-white"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => adjustFocusMinutes(5)}
                            aria-label="Increase focus duration"
                            className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.06] text-slate-300 hover:bg-white/14 hover:text-white"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      <div className="my-1.5 flex items-center justify-between gap-2">
                        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
                          <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
                            <circle
                              cx="32"
                              cy="32"
                              r={ringRadius}
                              fill="none"
                              stroke="rgba(255,255,255,0.08)"
                              strokeWidth="4.5"
                            />
                            <circle
                              cx="32"
                              cy="32"
                              r={ringRadius}
                              fill="none"
                              stroke="#10B981"
                              strokeWidth="4.5"
                              strokeLinecap="round"
                              strokeDasharray={ringCirc}
                              strokeDashoffset={ringOffset}
                              className="transition-[stroke-dashoffset] duration-300"
                            />
                          </svg>
                          <span className="absolute font-mono text-[12px] font-semibold text-white tabular-nums">
                            {focusMM}:{focusSS}
                          </span>
                        </div>

                        <div className="flex flex-1 flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (focusSecondsLeft === 0) {
                                setFocusSecondsLeft(focusMinutes * 60);
                              }
                              setFocusRunning((r) => !r);
                            }}
                            className={`flex h-7 items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold transition-colors ${
                              focusRunning
                                ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                                : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                            }`}
                          >
                            {focusRunning ? (
                              <>
                                <Pause className="h-3 w-3" />
                                <span>Pause</span>
                              </>
                            ) : (
                              <>
                                <Play className="h-3 w-3" />
                                <span>Start</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFocusRunning(false);
                              setFocusSecondsLeft(focusMinutes * 60);
                            }}
                            className="flex h-6 items-center justify-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] text-[10px] text-slate-300 hover:bg-white/10 hover:text-white"
                          >
                            <RotateCcw className="h-2.5 w-2.5" />
                            <span>Reset</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 2. Keep-Awake ("Coffee") Toggle Card */}
                    <button
                      type="button"
                      onClick={onToggleKeepAwake}
                      className={`flex h-[52px] items-center justify-between rounded-[18px] border px-3 transition-colors ${
                        isPatrolling
                          ? "border-emerald-400/35 bg-emerald-500/12"
                          : "border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.06]"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-xl ${
                            isPatrolling
                              ? "bg-emerald-400/20 text-emerald-300"
                              : "bg-white/[0.07] text-slate-300"
                          }`}
                        >
                          <Coffee className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-left">
                          <span className="block text-xs font-medium text-white">Coffee</span>
                          <span className="block text-[10px] text-slate-400">
                            {isPatrolling ? "Always · Patrol On" : "Off · Click to keep awake"}
                          </span>
                        </span>
                      </span>

                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
                          isPatrolling ? "bg-emerald-400" : "bg-white/15"
                        }`}
                      >
                        <span
                          className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            isPatrolling ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </span>
                    </button>
                  </div>

                  {/* MIDDLE COLUMN: Media Player Card + Quick Notes Card */}
                  <div className="flex flex-col gap-2.5 sm:col-span-4">
                    {/* 1. Media Player Card */}
                    <div className="flex flex-1 flex-col justify-between rounded-[18px] border border-white/[0.08] bg-white/[0.035] p-3">
                      <button
                        type="button"
                        onClick={() => openSubView("media")}
                        className="group flex items-center gap-2.5 text-left"
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-slate-900">
                          {currentTrack?.artworkUrl ? (
                            <img
                              src={currentTrack.artworkUrl}
                              alt={currentTrack.title}
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Music2 className="h-4 w-4 text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-xs font-semibold text-white group-hover:text-emerald-200">
                            {currentTrack ? currentTrack.title : "Media Player"}
                          </p>
                          <p className="truncate text-[11px] text-slate-400">
                            {currentTrack ? currentTrack.artist : "Open Media & Lyrics"}
                          </p>
                        </div>
                      </button>

                      <div className="mt-2.5 space-y-2">
                        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            style={{ width: `${Math.min(100, Math.max(0, trackProgress))}%` }}
                            className="h-full rounded-full bg-emerald-400 transition-[width] duration-200"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={onPrevTrack}
                            aria-label="Previous song"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
                          >
                            <SkipBack className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={
                              currentTrack
                                ? onTogglePlayPause
                                : () => {
                                    openSubView("media");
                                    void onSearchSongsDirect("Blinding Lights");
                                  }
                            }
                            aria-label={isTrackPlaying ? "Pause song" : "Play song"}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#0b0e14] transition-transform hover:scale-105"
                          >
                            {isTrackPlaying ? (
                              <Pause className="h-3.5 w-3.5" />
                            ) : (
                              <Play className="h-3.5 w-3.5 translate-x-[0.5px]" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={onNextTrack}
                            aria-label="Next song"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
                          >
                            <SkipForward className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 2. Quick Notes Card */}
                    <button
                      type="button"
                      onClick={() => openSubView("notes")}
                      className="flex h-[68px] flex-col justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-left transition-colors hover:border-white/16 hover:bg-white/[0.06]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-300">
                          <StickyNote className="h-3 w-3" />
                          <span>Notes</span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {notes.length}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs font-medium text-slate-100">
                        {notePreviewTitle}
                      </p>
                      <p className="truncate text-[10.5px] text-slate-400">{notePreviewBody}</p>
                    </button>
                  </div>

                  {/* RIGHT COLUMN: Compact 4x2 Tool & Telemetry Grid */}
                  <div className="grid grid-cols-4 gap-2 sm:col-span-4">
                    {/* 1. NOVA AI Chat & Voice */}
                    <button
                      type="button"
                      onClick={() => openSubView("ai")}
                      title="NOVA AI Chat & Voice"
                      className="flex flex-col items-center justify-center gap-1.5 rounded-[16px] border border-white/[0.08] bg-white/[0.045] p-2 text-center transition-colors hover:border-emerald-400/35 hover:bg-emerald-500/12"
                    >
                      <Sparkles className="h-4 w-4 text-emerald-300" />
                      <span className="text-[10px] font-medium text-slate-200">AI Chat</span>
                    </button>

                    {/* 2. Live Voice Mic */}
                    <button
                      type="button"
                      onClick={() => {
                        openSubView("ai");
                        onToggleLiveVoice();
                      }}
                      title="Toggle Gemini Live Voice"
                      className={`flex flex-col items-center justify-center gap-1.5 rounded-[16px] border p-2 text-center transition-colors ${
                        isLiveActive
                          ? "border-rose-400/40 bg-rose-500/20 text-rose-100"
                          : "border-white/[0.08] bg-white/[0.045] text-slate-200 hover:border-white/20 hover:bg-white/[0.09]"
                      }`}
                    >
                      <Mic className={`h-4 w-4 ${isLiveActive ? "text-rose-200" : "text-sky-300"}`} />
                      <span className="text-[10px] font-medium">
                        {isLiveActive ? "Live" : "Voice"}
                      </span>
                    </button>

                    {/* 3. System Monitor (Live Mini CPU Ring) */}
                    <button
                      type="button"
                      onClick={() => openSubView("monitor")}
                      title="System Monitor & Top Apps"
                      className="flex flex-col items-center justify-center gap-1 rounded-[16px] border border-white/[0.08] bg-white/[0.045] p-1.5 text-center transition-colors hover:border-white/20 hover:bg-white/[0.09]"
                    >
                      <span className="relative flex h-7 w-7 items-center justify-center">
                        <svg className="h-7 w-7 -rotate-90" viewBox="0 0 28 28">
                          <circle
                            cx="14"
                            cy="14"
                            r={miniCpuRadius}
                            fill="none"
                            stroke="rgba(255,255,255,0.1)"
                            strokeWidth="2.5"
                          />
                          <circle
                            cx="14"
                            cy="14"
                            r={miniCpuRadius}
                            fill="none"
                            stroke="#34D399"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeDasharray={miniCpuCirc}
                            strokeDashoffset={miniCpuOffset}
                          />
                        </svg>
                        <span className="absolute font-mono text-[8.5px] font-semibold text-white tabular-nums">
                          {telemetry.cpuCurrent}
                        </span>
                      </span>
                      <span className="text-[10px] font-medium text-slate-200">CPU</span>
                    </button>

                    {/* 4. Calendar (Live Day Tile) */}
                    <button
                      type="button"
                      onClick={() => openSubView("calendar")}
                      title="Calendar & Reminders"
                      className="flex flex-col items-center justify-center rounded-[16px] border border-white/[0.08] bg-white/[0.045] p-1.5 text-center transition-colors hover:border-white/20 hover:bg-white/[0.09]"
                    >
                      <span className="font-mono text-[9px] font-semibold text-rose-400">
                        {monthShort}
                      </span>
                      <span className="font-display text-base leading-tight font-bold text-white tabular-nums">
                        {dayNum}
                      </span>
                    </button>

                    {/* 5. Notes */}
                    <button
                      type="button"
                      onClick={() => openSubView("notes")}
                      title="Quick Notes"
                      className="flex flex-col items-center justify-center gap-1.5 rounded-[16px] border border-white/[0.08] bg-white/[0.045] p-2 text-center transition-colors hover:border-white/20 hover:bg-white/[0.09]"
                    >
                      <StickyNote className="h-4 w-4 text-amber-300" />
                      <span className="text-[10px] font-medium text-slate-200">Notes</span>
                    </button>

                    {/* 6. Folder & App Manager */}
                    <button
                      type="button"
                      onClick={() => openSubView("monitor")}
                      title="Folder & App Manager"
                      className="flex flex-col items-center justify-center gap-1.5 rounded-[16px] border border-white/[0.08] bg-white/[0.045] p-2 text-center transition-colors hover:border-white/20 hover:bg-white/[0.09]"
                    >
                      <FolderKanban className="h-4 w-4 text-sky-300" />
                      <span className="text-[10px] font-medium text-slate-200">Apps</span>
                    </button>

                    {/* 7. Security Vault (2FA) */}
                    <button
                      type="button"
                      onClick={onOpenVault}
                      title="2FA Security Vault"
                      className="flex flex-col items-center justify-center gap-1.5 rounded-[16px] border border-white/[0.08] bg-white/[0.045] p-2 text-center transition-colors hover:border-emerald-400/35 hover:bg-emerald-500/12"
                    >
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      <span className="text-[10px] font-medium text-slate-200">Vault</span>
                    </button>

                    {/* 8. Lock Workstation (Session-0) */}
                    <button
                      type="button"
                      onClick={onLockWorkstation}
                      title="Lock Workstation (Session-0 2FA)"
                      className="flex flex-col items-center justify-center gap-1.5 rounded-[16px] border border-white/[0.08] bg-white/[0.045] p-2 text-center transition-colors hover:border-rose-400/35 hover:bg-rose-500/15"
                    >
                      <Lock className="h-4 w-4 text-slate-300" />
                      <span className="text-[10px] font-medium text-slate-200">Lock</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ==================== SUB-VIEW CONTAINER (WITH <- BACK HEADER) ==================== */}
            {expanded && activeView !== "bento" && (
              <motion.div
                key={`subview-${activeView}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="relative z-10 p-3.5"
              >
                {/* Unified <- Back Sub-View Header + Theme Switcher */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
                  <button
                    type="button"
                    onClick={() => onChangeView("bento")}
                    className="flex items-center gap-2 rounded-lg px-1.5 py-0.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.08]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 text-slate-300" />
                    <span className="font-display">
                      {activeView === "ai"
                        ? `${displayName} & Security`
                        : VIEW_TITLES[activeView]}
                    </span>
                  </button>

                  <div className="flex items-center gap-2">
                    <OpticalIris mode={irisMode} ambient={activeAmbient} size="sm" />
                    {isAudioActive && (
                      <MiniSpectrumBars
                        active={true}
                        colorA={activeAmbient.eqColorA}
                        colorB={activeAmbient.eqColorB}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setPinnedOpen(false);
                        onToggleExpanded(false);
                      }}
                      aria-label="Collapse notch"
                      className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {activeView === "media" && (
                  <MediaSubView
                    currentTrack={currentTrack}
                    isTrackPlaying={isTrackPlaying}
                    trackProgress={trackProgress}
                    songResults={songResults}
                    onPlayTrack={onPlayTrack}
                    onTogglePlayPause={onTogglePlayPause}
                    onStopTrack={onStopTrack}
                    onNextTrack={onNextTrack}
                    onPrevTrack={onPrevTrack}
                    onSearchSongsDirect={onSearchSongsDirect}
                  />
                )}

                {activeView === "monitor" && (
                  <SystemMonitorSubView
                    telemetry={telemetry}
                    apps={apps}
                    onOpenAppWindow={onOpenAppWindow}
                    onCloseAppWindow={onCloseAppWindow}
                    onAttemptProtectedProcess={onAttemptProtectedProcess}
                  />
                )}

                {activeView === "calendar" && (
                  <CalendarSubView
                    reminders={reminders}
                    onAddReminder={(dateKey, text) => {
                      setReminders((prev) => [
                        ...prev,
                        {
                          id: `rem-${Date.now()}`,
                          dateKey,
                          text,
                          time: new Date().toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                          done: false,
                        },
                      ]);
                    }}
                    onToggleReminder={(id) => {
                      setReminders((prev) =>
                        prev.map((r) => (r.id === id ? { ...r, done: !r.done } : r))
                      );
                    }}
                    onDeleteReminder={(id) => {
                      setReminders((prev) => prev.filter((r) => r.id !== id));
                    }}
                  />
                )}

                {activeView === "notes" && (
                  <NotesSubView
                    notes={notes}
                    activeNoteId={activeNoteId}
                    onSelectNote={setActiveNoteId}
                    onCreateNote={() => {
                      const next: NotchNote = {
                        id: `note-${Date.now()}`,
                        content: "",
                        updatedAt: "Just now",
                      };
                      setNotes((prev) => [next, ...prev]);
                      setActiveNoteId(next.id);
                    }}
                    onUpdateNote={(id, content) => {
                      setNotes((prev) =>
                        prev.map((n) =>
                          n.id === id
                            ? {
                                ...n,
                                content,
                                updatedAt: new Date().toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }),
                              }
                            : n
                        )
                      );
                    }}
                    onDeleteNote={(id) => {
                      setNotes((prev) => {
                        const filtered = prev.filter((n) => n.id !== id);
                        if (activeNoteId === id && filtered[0]) {
                          setActiveNoteId(filtered[0].id);
                        }
                        return filtered;
                      });
                    }}
                  />
                )}

                {activeView === "ai" && (
                  <NovaAISubView
                    assistantLabel={displayName}
                    orbState={orbState}
                    liveStatus={liveStatus}
                    liveInputTranscript={liveInputTranscript}
                    liveOutputTranscript={liveOutputTranscript}
                    inputValue={inputValue}
                    onInputChange={onInputChange}
                    onSubmitCommand={onSubmitCommand}
                    onToggleLiveVoice={onToggleLiveVoice}
                    lastReply={lastReply}
                    lastResolvedRef={lastResolvedRef}
                    lastSources={lastSources}
                    lastError={lastError}
                    retryableError={retryableError}
                    onRetryLastCommand={onRetryLastCommand}
                    memoryCount={memoryCount}
                    folders={folders}
                    vault={vault}
                    airMouseEnabled={airMouseEnabled}
                    onToggleAirMouse={onToggleAirMouse}
                    onOpenVault={onOpenVault}
                    onLockWorkstation={onLockWorkstation}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </>
  );
};
