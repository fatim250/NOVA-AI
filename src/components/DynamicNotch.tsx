import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronUp,
  Mic,
  Music2,
  Pause,
  PhoneOff,
  Play,
  RotateCw,
  Square,
} from "lucide-react";
import type { GroundingSource, SongTrack } from "../types/notch";
import { MEMORY_WINDOW_SIZE } from "../utils/memoryBuffer";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "locked";
export type LiveVoiceStatus = "disconnected" | "connecting" | "live" | "speaking";

interface DynamicNotchProps {
  assistantName: string;
  browserAutoHide: boolean;
  expanded: boolean;
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
}

/**
 * Precision optical AI iris — dark sapphire & liquid platinum lens
 * engineered to feel like flagship hardware glass rather than neon UI.
 */
const OpticalIris: React.FC<{
  mode: "idle" | "live" | "thinking" | "speaking" | "locked" | "music";
}> = ({ mode }) => {
  const palette = {
    idle: {
      halo: "rgba(186, 212, 255, 0.24)",
      core: "radial-gradient(circle at 34% 30%, #F8FAFC 0%, #93C5FD 38%, #3B82F6 74%, #1E293B 100%)",
      ring: "conic-gradient(from 0deg, rgba(255,255,255,0.55), rgba(147,197,253,0.12), rgba(255,255,255,0.04), rgba(255,255,255,0.55))",
    },
    live: {
      halo: "rgba(110, 231, 183, 0.34)",
      core: "radial-gradient(circle at 34% 30%, #ECFDF5 0%, #6EE7B7 42%, #0EA5E9 80%, #0F172A 100%)",
      ring: "conic-gradient(from 0deg, rgba(167,243,208,0.75), rgba(56,189,248,0.18), rgba(255,255,255,0.05), rgba(167,243,208,0.75))",
    },
    thinking: {
      halo: "rgba(251, 191, 36, 0.32)",
      core: "radial-gradient(circle at 34% 30%, #FFFBEB 0%, #FDE68A 42%, #F59E0B 78%, #1E293B 100%)",
      ring: "conic-gradient(from 0deg, rgba(253,230,138,0.85), rgba(251,191,36,0.15), rgba(255,255,255,0.04), rgba(253,230,138,0.85))",
    },
    speaking: {
      halo: "rgba(147, 197, 253, 0.38)",
      core: "radial-gradient(circle at 34% 30%, #FFFFFF 0%, #BAE6FD 40%, #38BDF8 76%, #1D4ED8 100%)",
      ring: "conic-gradient(from 0deg, rgba(255,255,255,0.8), rgba(125,211,252,0.22), rgba(255,255,255,0.05), rgba(255,255,255,0.8))",
    },
    locked: {
      halo: "rgba(251, 113, 133, 0.28)",
      core: "radial-gradient(circle at 34% 30%, #FFF1F2 0%, #FDA4AF 40%, #E11D48 78%, #1E1B2E 100%)",
      ring: "conic-gradient(from 0deg, rgba(253,164,175,0.7), rgba(244,63,94,0.15), rgba(255,255,255,0.04), rgba(253,164,175,0.7))",
    },
    music: {
      halo: "rgba(226, 232, 240, 0.26)",
      core: "radial-gradient(circle at 34% 30%, #FFFFFF 0%, #CBD5E1 45%, #64748B 82%, #0F172A 100%)",
      ring: "conic-gradient(from 0deg, rgba(255,255,255,0.72), rgba(148,163,184,0.14), rgba(255,255,255,0.04), rgba(255,255,255,0.72))",
    },
  }[mode];

  return (
    <span className="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center">
      <span
        style={{ background: palette.halo }}
        className="iris-breathe absolute inset-[-3px] rounded-full blur-[6px]"
      />
      <span
        style={{ background: palette.ring }}
        className={`${
          mode === "thinking" || mode === "speaking" ? "iris-orbit-fast" : "iris-orbit"
        } absolute inset-0 rounded-full p-[1.5px]`}
      >
        <span className="block h-full w-full rounded-full bg-[#090B10]" />
      </span>
      <span
        style={{ background: palette.core }}
        className="iris-breathe relative h-[14px] w-[14px] rounded-full shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.65)]"
      />
    </span>
  );
};

const LiveEqualizer: React.FC<{ active: boolean }> = ({ active }) => (
  <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
    <span
      className={`w-[2px] origin-bottom rounded-full bg-slate-200 ${
        active ? "eq-bar-1 h-3" : "h-1 opacity-40"
      }`}
    />
    <span
      className={`w-[2px] origin-bottom rounded-full bg-slate-100 ${
        active ? "eq-bar-2 h-3" : "h-1.5 opacity-40"
      }`}
    />
    <span
      className={`w-[2px] origin-bottom rounded-full bg-slate-300 ${
        active ? "eq-bar-3 h-3" : "h-1 opacity-40"
      }`}
    />
  </span>
);

export const DynamicNotch: React.FC<DynamicNotchProps> = ({
  assistantName,
  browserAutoHide,
  expanded,
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
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [bezelHovered, setBezelHovered] = useState(false);
  const isLiveActive = liveStatus !== "disconnected";

  // Automatically vanish while working inside a web browser unless expanded, speaking/thinking, or top-bezel hovered
  const isInvisibleForBrowser =
    browserAutoHide &&
    !expanded &&
    !bezelHovered &&
    !isLiveActive &&
    orbState !== "thinking" &&
    orbState !== "speaking";

  useEffect(() => {
    if (expanded && !isLiveActive) {
      const timer = setTimeout(() => inputRef.current?.focus(), 110);
      return () => clearTimeout(timer);
    }
  }, [expanded, isLiveActive]);

  const irisMode = (() => {
    if (liveStatus === "connecting" || orbState === "thinking") return "thinking" as const;
    if (liveStatus === "speaking" || orbState === "speaking") return "speaking" as const;
    if (liveStatus === "live" || orbState === "listening") return "live" as const;
    if (isLocked || orbState === "locked") return "locked" as const;
    if (currentTrack && isTrackPlaying) return "music" as const;
    return "idle" as const;
  })();

  const cleanName = assistantName.trim();

  // Starts completely nameless by default until the user assigns a name themselves
  const statusText = (() => {
    if (liveStatus === "connecting") return "Connecting...";
    if (liveStatus === "live") return "Listening";
    if (liveStatus === "speaking") return cleanName || "Speaking";
    if (orbState === "thinking") return "Thinking...";
    if (orbState === "speaking") return cleanName || "Speaking";
    if (isLocked) return "Session-0";
    if (currentTrack && !expanded) return currentTrack.title;
    return cleanName; // Empty string when nameless -> pure minimal iris-only idle silhouette
  })();

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onSubmitCommand(trimmed);
  };

  // Sleek compact width when nameless, expands gracefully once named or playing music
  const pillWidth = expanded
    ? 452
    : currentTrack
    ? 336
    : statusText
    ? 248
    : 168;

  return (
    <>
      {/* Top-Edge Invisible Hot-Zone to smoothly reveal the assistant while working in Chrome/Edge */}
      {browserAutoHide && !expanded && (
        <div
          onMouseEnter={() => setBezelHovered(true)}
          onClick={() => {
            setBezelHovered(true);
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
        onMouseLeave={() => setBezelHovered(false)}
        className={`absolute inset-x-0 top-3.5 z-40 flex justify-center px-3 transition-all duration-200 ${
          isInvisibleForBrowser ? "pointer-events-none" : "pointer-events-none"
        }`}
      >
        <motion.div
          layout
          animate={
            isInvisibleForBrowser
              ? { opacity: 0, y: -26, scale: 0.92 }
              : { opacity: 1, y: 0, scale: 1 }
          }
          transition={{ type: "spring", stiffness: 460, damping: 36, mass: 0.72 }}
          style={{
            width: pillWidth,
            minHeight: expanded ? 154 : 46,
            borderRadius: expanded ? 24 : 999,
          }}
          className={`notch-obsidian-shell relative max-w-full overflow-hidden border border-white/[0.11] backdrop-blur-3xl saturate-150 ${
            isInvisibleForBrowser ? "pointer-events-none" : "pointer-events-auto"
          }`}
        >
          {/* Top-edge subtle studio specular highlight */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-6 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent"
          />

          {/* IDLE PILL HEADER BAR — Minimal, nameless by default, machined glass */}
          <div className="flex h-[46px] items-center justify-between gap-2 pl-3 pr-2">
            <button
              type="button"
              onClick={() => onToggleExpanded()}
              className="group flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none"
              aria-label={expanded ? "Collapse assistant" : "Expand assistant"}
            >
              {currentTrack && !expanded && currentTrack.artworkUrl ? (
                <span className="relative flex h-[24px] w-[24px] shrink-0 overflow-hidden rounded-full border border-white/15 bg-slate-900">
                  <img
                    src={currentTrack.artworkUrl}
                    alt={currentTrack.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </span>
              ) : (
                <OpticalIris mode={irisMode} />
              )}

              {(statusText || isTrackPlaying || liveStatus === "speaking") && (
                <span className="flex min-w-0 items-center gap-2">
                  {statusText && (
                    <span className="truncate font-display text-[13px] font-semibold tracking-[-0.01em] text-slate-100 transition-colors group-hover:text-white">
                      {statusText}
                    </span>
                  )}
                  {(isTrackPlaying && !expanded) || liveStatus === "speaking" ? (
                    <LiveEqualizer active={true} />
                  ) : null}
                </span>
              )}
            </button>

            {/* Precision Tactile Controls */}
            <div className="flex shrink-0 items-center gap-1">
              {currentTrack && !expanded && (
                <>
                  <button
                    type="button"
                    onClick={onTogglePlayPause}
                    aria-label={isTrackPlaying ? "Pause song" : "Resume song"}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-slate-200 transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                  >
                    {isTrackPlaying ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5 translate-x-[0.5px]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onStopTrack}
                    aria-label="Stop song"
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/[0.1] hover:text-rose-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                  >
                    <Square className="h-3 w-3" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={onToggleLiveVoice}
                aria-label={
                  isLiveActive ? "End live voice conversation" : "Start live voice conversation"
                }
                className={`flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 ${
                  isLiveActive
                    ? "border border-rose-400/35 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30"
                    : "border border-white/[0.08] bg-white/[0.05] text-slate-200 hover:bg-white/[0.11] hover:text-white"
                }`}
              >
                {isLiveActive ? (
                  <>
                    <PhoneOff className="h-3.5 w-3.5" />
                    <span>End</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-3.5 w-3.5 text-slate-300" />
                    <span>Mic</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => onToggleExpanded()}
                aria-label={expanded ? "Collapse card" : "Ask assistant"}
                className={`flex h-[30px] items-center justify-center rounded-full text-[12px] font-semibold whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${
                  expanded
                    ? "w-[30px] border border-white/[0.08] bg-white/[0.06] text-slate-300 hover:bg-white/[0.12] hover:text-white"
                    : "bg-white/[0.94] px-3.5 text-[#090B10] shadow-[0_1px_2px_rgba(0,0,0,0.4)] hover:bg-white"
                }`}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : "Ask"}
              </button>
            </div>
          </div>

          {/* POP-DOWN CONVERSATIONAL CARD */}
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="notch-card"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="border-t border-white/[0.07] px-3.5 pb-3.5 pt-3"
              >
                {/* AI Response Surface */}
                <div className="mb-2.5 rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5">
                  {lastError ? (
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] leading-[1.5] text-rose-300">{lastError}</p>
                      {retryableError && (
                        <button
                          type="button"
                          onClick={onRetryLastCommand}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/12 px-2.5 py-1 text-[11px] font-medium text-rose-200 transition-colors hover:bg-rose-500/22"
                        >
                          <RotateCw className="h-3 w-3" />
                          Retry
                        </button>
                      )}
                    </div>
                  ) : isLiveActive ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-emerald-300">
                          {liveStatus === "connecting"
                            ? "Connecting real-time audio session..."
                            : "Live Voice active — speak naturally or interrupt anytime"}
                        </span>
                        <LiveEqualizer
                          active={liveStatus === "live" || liveStatus === "speaking"}
                        />
                      </div>
                      {liveInputTranscript && (
                        <p className="text-[12px] leading-relaxed text-slate-400">
                          You · <span className="text-slate-200">{liveInputTranscript}</span>
                        </p>
                      )}
                      {liveOutputTranscript && (
                        <p className="text-[13.5px] leading-[1.55] text-slate-100">
                          {liveOutputTranscript}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="text-[13.5px] leading-[1.55] tracking-[-0.005em] text-slate-100">
                        {lastReply}
                      </p>

                      {lastResolvedRef && (
                        <p className="mt-1.5 font-mono text-[11px] text-slate-400">
                          Memory · <span className="text-slate-300">{lastResolvedRef}</span>
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
                                className="inline-flex max-w-[148px] items-center gap-0.5 text-slate-200 transition-colors hover:text-white hover:underline"
                              >
                                <span className="truncate">{src.title || `Result ${i + 1}`}</span>
                                <ArrowUpRight className="h-3 w-3 shrink-0 text-slate-400" />
                              </a>
                            </React.Fragment>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Studio Audio Mini-Player */}
                {currentTrack && (
                  <div className="mb-2.5 rounded-[14px] border border-white/[0.08] bg-white/[0.035] p-2.5">
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-white/10 bg-slate-900">
                        {currentTrack.artworkUrl ? (
                          <img
                            src={currentTrack.artworkUrl}
                            alt={`${currentTrack.title} cover art`}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Music2 className="h-4 w-4 text-slate-300" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-display text-[13px] font-semibold text-white">
                            {currentTrack.title}
                          </p>
                          <LiveEqualizer active={isTrackPlaying} />
                        </div>
                        <p className="truncate text-[11.5px] text-slate-400">
                          {currentTrack.artist}
                          {currentTrack.album ? ` · ${currentTrack.album}` : ""}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={onTogglePlayPause}
                          aria-label={isTrackPlaying ? "Pause song" : "Resume song"}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.94] text-[#090B10] transition-colors hover:bg-white"
                        >
                          {isTrackPlaying ? (
                            <Pause className="h-3.5 w-3.5" />
                          ) : (
                            <Play className="h-3.5 w-3.5 translate-x-[0.5px]" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={onStopTrack}
                          aria-label="Stop song"
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-slate-300 transition-colors hover:bg-white/[0.12] hover:text-rose-300"
                        >
                          <Square className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2.5 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.1]">
                      <div
                        style={{ width: `${Math.min(100, Math.max(0, trackProgress))}%` }}
                        className="h-full rounded-full bg-white/90 transition-[width] duration-200"
                      />
                    </div>
                  </div>
                )}

                {/* Compact Song Search Track List */}
                {songResults.length > 0 && (
                  <div className="mb-2.5 max-h-36 overflow-y-auto rounded-[14px] border border-white/[0.07] bg-white/[0.025] divide-y divide-white/[0.06]">
                    {songResults.slice(0, 4).map((track) => {
                      const isCurrent = currentTrack?.id === track.id;
                      return (
                        <div
                          key={track.id}
                          className="group flex items-center justify-between gap-2.5 px-2.5 py-2 transition-colors hover:bg-white/[0.04]"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-slate-900">
                              {track.artworkUrl ? (
                                <img
                                  src={track.artworkUrl}
                                  alt={track.title}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <Music2 className="h-3.5 w-3.5 text-slate-400" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p
                                className={`truncate text-[12px] font-medium ${
                                  isCurrent ? "text-white" : "text-slate-200"
                                }`}
                              >
                                {track.title}
                              </p>
                              <p className="truncate text-[11px] text-slate-400">{track.artist}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onPlayTrack(track)}
                            className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors ${
                              isCurrent && isTrackPlaying
                                ? "bg-white/[0.94] text-[#090B10]"
                                : "border border-white/[0.08] bg-white/[0.05] text-slate-200 hover:bg-white/[0.14] hover:text-white"
                            }`}
                          >
                            <Play className="h-2.5 w-2.5" />
                            <span>{isCurrent && isTrackPlaying ? "Playing" : "Play"}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Recessed Natural-Language Command Bar */}
                <form
                  onSubmit={handleFormSubmit}
                  className="flex items-center gap-2 rounded-[14px] border border-white/[0.09] bg-white/[0.04] p-1 pl-3.5 transition-colors focus-within:border-white/[0.24] focus-within:bg-white/[0.06]"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder={
                      cleanName
                        ? `Ask ${cleanName} anything...`
                        : "Ask anything... or give me a name"
                    }
                    className="h-8 flex-1 bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!inputValue.trim() || orbState === "thinking"}
                    aria-label="Send command"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.94] text-[#090B10] transition-all hover:bg-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </form>

                {/* Whisper-Quiet Metadata Footer */}
                <div className="mt-2.5 flex items-center justify-between px-1 text-[11px] text-slate-500">
                  <span>
                    {isLiveActive
                      ? "Gemini 3.8 Live · Real-time audio"
                      : cleanName
                      ? `${cleanName} · Auto-hides in browser`
                      : "Nameless · Auto-hides in browser"}
                  </span>
                  <span className="font-mono tabular-nums text-slate-400">
                    Memory {memoryCount}/{MEMORY_WINDOW_SIZE}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
};
