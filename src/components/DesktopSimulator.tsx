import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Folder,
  Globe,
  Hand,
  Minimize2,
  OctagonAlert,
  Plus,
  RotateCcw,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import type {
  DesktopApp,
  GroundingSource,
  RecycledFolder,
  SandboxRoot,
  SongTrack,
  VaultState,
  VirtualFolder,
} from "../types/notch";
import { DynamicNotch, type LiveVoiceStatus, type OrbState } from "./DynamicNotch";
import type { NotchSubView } from "./NotchBentoSubViews";
import { ALLOWED_SANDBOX_ROOTS } from "../utils/sandboxEngine";

const DESKTOP_WALLPAPER = "/src/assets/images/windows_desktop_wallpaper_1795684537296.jpg";
const LOCK_WALLPAPER = "/src/assets/images/windows_lock_wallpaper_1795684538223.jpg";

interface DesktopSimulatorProps {
  assistantName: string;
  focusedAppId: string | null;
  onFocusApp: (appId: string | null) => void;
  notchExpanded: boolean;
  activeNotchView: NotchSubView;
  onChangeNotchView: (view: NotchSubView) => void;
  onToggleNotch: (next?: boolean) => void;
  orbState: OrbState;
  liveStatus: LiveVoiceStatus;
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
  isLocked: boolean;
  onLockWorkstation: () => void;
  onAttempt2FAUnlock: (passphrase: string, speakerMode: "owner" | "impostor") => Promise<{
    ok: boolean;
    message: string;
    similarity: number;
  }>;
  vault: VaultState;
  folders: VirtualFolder[];
  recycledFolders: RecycledFolder[];
  onRestoreRecycled: (id: string) => void;
  explorerOpen: boolean;
  onCloseExplorer: () => void;
  apps: DesktopApp[];
  onOpenAppWindow: (appId: string) => void;
  onCloseAppWindow: (appId: string) => void;
  onAttemptProtectedProcess: (procName: string) => void;
  onNavigateChrome: (queryOrUrl: string) => void;
  cursorPos: { x: number; y: number };
  clickRipple: { x: number; y: number; id: number } | null;
  isPatrolling: boolean;
  onToggleKeepAwake: () => void;
  airMouseEnabled: boolean;
  onToggleAirMouse: () => void;
  onEmergencyStop: () => void;
  onTriggerGesture: (gesture: "Pointing_Up" | "Closed_Fist" | "Thumb_Up" | "Thumb_Down") => void;
  onOpenVault: () => void;
}

export const DesktopSimulator: React.FC<DesktopSimulatorProps> = ({
  assistantName,
  focusedAppId,
  onFocusApp,
  notchExpanded,
  activeNotchView,
  onChangeNotchView,
  onToggleNotch,
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
  isLocked,
  onLockWorkstation,
  onAttempt2FAUnlock,
  vault,
  folders,
  recycledFolders,
  onRestoreRecycled,
  explorerOpen,
  onCloseExplorer,
  apps,
  onOpenAppWindow,
  onCloseAppWindow,
  onAttemptProtectedProcess,
  onNavigateChrome,
  cursorPos,
  clickRipple,
  isPatrolling,
  onToggleKeepAwake,
  airMouseEnabled,
  onToggleAirMouse,
  onEmergencyStop,
  onTriggerGesture,
  onOpenVault,
}) => {
  const [activeRootTab, setActiveRootTab] = useState<SandboxRoot | "Recycle Bin">("Desktop");
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [speakerMode, setSpeakerMode] = useState<"owner" | "impostor">("owner");
  const [unlockFeedback, setUnlockFeedback] = useState<{
    ok: boolean;
    message: string;
    similarity: number;
  } | null>(null);
  const [nowTime, setNowTime] = useState(() => new Date());
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [chromeInput, setChromeInput] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(new Date());
      if (vault.lockoutUntil && vault.lockoutUntil > Date.now()) {
        setLockoutRemaining(Math.ceil((vault.lockoutUntil - Date.now()) / 1000));
      } else {
        setLockoutRemaining(0);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [vault.lockoutUntil]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (isPatrolling || airMouseEnabled)) {
        onEmergencyStop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPatrolling, airMouseEnabled, onEmergencyStop]);

  const [activeBrowserTab, setActiveBrowserTab] = useState(0);
  const [browserTabs, setBrowserTabs] = useState<string[]>([
    "New Tab",
    "Google Workspace · Docs",
    "GitHub · Pull Requests",
  ]);

  const openApps = apps.filter((a) => a.isOpen);
  const focusedBrowserApp =
    !isLocked && (focusedAppId === "chrome" || focusedAppId === "edge")
      ? openApps.find((a) => a.id === focusedAppId) ?? null
      : null;
  const isBrowserFocused = Boolean(focusedBrowserApp);
  const filteredFolders =
    activeRootTab === "Recycle Bin"
      ? []
      : folders.filter((f) => f.root === activeRootTab);

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await onAttempt2FAUnlock(unlockPassphrase, speakerMode);
    setUnlockFeedback(result);
    if (result.ok) {
      setUnlockPassphrase("");
    }
  };

  const formattedClock = nowTime.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const formattedDate = nowTime.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-[#070B14] via-[#050811] to-[#02040A]">
      {/* Clean Subtle Ambient Desktop Wallpaper */}
      <img
        src={isLocked ? LOCK_WALLPAPER : DESKTOP_WALLPAPER}
        alt={isLocked ? "Windows 11 lock screen backdrop" : "Windows 11 dark glass desktop wallpaper"}
        referrerPolicy="no-referrer"
        className="absolute inset-0 h-full w-full object-cover opacity-75 transition-opacity duration-300"
      />
      <div
        className={`absolute inset-0 transition-colors duration-300 ${
          isLocked
            ? "bg-gradient-to-b from-slate-950/65 via-slate-950/40 to-slate-950/85"
            : "bg-gradient-to-b from-slate-950/35 via-slate-950/15 to-slate-950/55"
        }`}
      />

      {/* Top-Center Floating Dynamic Island (ONLY permanent element on screen; auto-hides in Browser) */}
      <DynamicNotch
        assistantName={assistantName}
        browserAutoHide={isBrowserFocused}
        expanded={notchExpanded}
        activeView={activeNotchView}
        onChangeView={onChangeNotchView}
        onToggleExpanded={onToggleNotch}
        orbState={orbState}
        liveStatus={liveStatus}
        liveInputTranscript={liveInputTranscript}
        liveOutputTranscript={liveOutputTranscript}
        isLocked={isLocked}
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
        isPatrolling={isPatrolling}
        onToggleKeepAwake={onToggleKeepAwake}
        airMouseEnabled={airMouseEnabled}
        onToggleAirMouse={onToggleAirMouse}
        apps={apps}
        folders={folders}
        vault={vault}
        onOpenAppWindow={onOpenAppWindow}
        onCloseAppWindow={onCloseAppWindow}
        onAttemptProtectedProcess={onAttemptProtectedProcess}
        onOpenVault={onOpenVault}
        onLockWorkstation={onLockWorkstation}
      />

      {/* UNLOCKED DESKTOP LAYER — 100% Empty unless user opens an App or File Explorer */}
      {!isLocked && (
        <div
          onClick={() => {
            if (focusedAppId) onFocusApp(null);
          }}
          className={`relative z-10 flex h-full flex-col justify-between transition-[padding] duration-200 ${
            isBrowserFocused ? "p-3" : "px-6 pb-14 pt-24"
          }`}
        >
            {/* MAXIMIZED FOCUSED BROWSER VIEW — Tabs sit cleanly at the very top while the assistant vanishes */}
            {focusedBrowserApp ? (
              <div
                onClick={(e) => e.stopPropagation()}
                className="mx-3 mb-2 flex flex-1 flex-col overflow-hidden rounded-xl border border-white/14 bg-[#10141D]/96 shadow-2xl backdrop-blur-xl"
              >
                {/* Realistic Chromium / Edge Top Tab Strip (100% Unobstructed — Assistant Auto-Hidden) */}
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] bg-[#0B0E15] px-2.5 pt-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                    {browserTabs.map((tabLabel, idx) => {
                      const active = activeBrowserTab === idx;
                      const displayLabel =
                        idx === 0 && focusedBrowserApp.windowTitle
                          ? focusedBrowserApp.windowTitle.replace(/^Google Chrome — |^Microsoft Edge — /, "")
                          : tabLabel;
                      return (
                        <button
                          key={`${tabLabel}-${idx}`}
                          type="button"
                          onClick={() => setActiveBrowserTab(idx)}
                          className={`group flex h-8 max-w-[190px] items-center gap-2 rounded-t-lg px-3 text-xs transition-colors ${
                            active
                              ? "border-x border-t border-white/[0.1] bg-[#161B26] font-medium text-white"
                              : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
                          }`}
                        >
                          <Globe className="h-3.5 w-3.5 shrink-0 text-sky-400/80" />
                          <span className="truncate">{displayLabel}</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        const nextIdx = browserTabs.length;
                        setBrowserTabs((prev) => [...prev, `Tab ${nextIdx + 1}`]);
                        setActiveBrowserTab(nextIdx);
                      }}
                      aria-label="Open new browser tab"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 pb-1">
                    <button
                      type="button"
                      onClick={() => onFocusApp(null)}
                      title="Restore window & show assistant"
                      className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
                    >
                      <Minimize2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Desktop</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onFocusApp(null);
                        onCloseAppWindow(focusedBrowserApp.id);
                      }}
                      aria-label={`Close ${focusedBrowserApp.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Browser Omnibox / Address Bar */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (chromeInput.trim()) {
                      onNavigateChrome(chromeInput.trim());
                      setChromeInput("");
                    }
                  }}
                  className="flex items-center gap-2 border-b border-white/[0.08] bg-[#161B26] px-3 py-2"
                >
                  <span className="font-mono text-[11px] text-slate-400">
                    {focusedBrowserApp.processName}
                  </span>
                  <input
                    type="text"
                    value={chromeInput}
                    onChange={(e) => setChromeInput(e.target.value)}
                    placeholder={focusedBrowserApp.browserUrl || "https://www.google.com"}
                    className="h-8 flex-1 rounded-full border border-white/[0.1] bg-[#0B0E15] px-3.5 text-xs text-slate-100 placeholder:text-slate-400 focus:border-white/25 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="h-8 rounded-full bg-white/[0.92] px-3.5 text-xs font-semibold text-[#090B10] transition-colors hover:bg-white"
                  >
                    Go
                  </button>
                </form>

                {/* Browser Viewport */}
                <div className="flex flex-1 flex-col justify-between p-6">
                  <div className="max-w-xl space-y-2.5">
                    <p className="font-mono text-[11px] text-slate-400">
                      {focusedBrowserApp.browserUrl || "https://www.google.com"}
                    </p>
                    <h3 className="font-display text-lg font-semibold text-white">
                      {browserTabs[activeBrowserTab] === "New Tab"
                        ? focusedBrowserApp.windowTitle
                        : browserTabs[activeBrowserTab]}
                    </h3>
                    <div className="space-y-1.5 pt-1 font-mono text-xs leading-relaxed text-slate-300">
                      {focusedBrowserApp.previewLines.map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                  </div>

                  <p className="text-xs text-slate-500">
                    Browser Focus Mode active · The top assistant is invisible so your tabs stay
                    completely clear. Hover the very top-center edge or click Desktop to bring it
                    back.
                  </p>
                </div>
              </div>
            ) : (explorerOpen || openApps.length > 0 || airMouseEnabled || isPatrolling) ? (
              <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto py-2">
                <div
                  className={`grid flex-1 grid-cols-1 gap-4 ${
                    explorerOpen && openApps.length > 0 ? "lg:grid-cols-12" : ""
                  }`}
                >
                  {/* Sandboxed Windows 11 File Explorer — ONLY shown when opened */}
                  {explorerOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={`flex max-h-[520px] flex-col overflow-hidden rounded-xl border border-white/12 bg-[#0F141E]/88 shadow-2xl backdrop-blur-xl ${
                        openApps.length > 0 ? "lg:col-span-5" : "mx-auto w-full max-w-2xl"
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                          <Folder className="h-3.5 w-3.5 text-sky-400" />
                          <span className="font-display">File Explorer · Sandboxed Roots</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {activeRootTab === "Recycle Bin"
                              ? `${recycledFolders.length} recycled`
                              : `${filteredFolders.length} folders`}
                          </span>
                          <button
                            type="button"
                            onClick={onCloseExplorer}
                            aria-label="Close File Explorer"
                            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Root Tabs */}
                      <div className="flex items-center gap-1 border-b border-white/8 bg-white/[0.02] px-2.5 py-1.5">
                        {[...ALLOWED_SANDBOX_ROOTS, "Recycle Bin" as const].map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setActiveRootTab(tab)}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                              activeRootTab === tab
                                ? "bg-white/12 text-white"
                                : "text-slate-400 hover:bg-white/6 hover:text-slate-200"
                            }`}
                          >
                            {tab}
                          </button>
                        ))}
                      </div>

                      {/* Folder Listing */}
                      <div className="flex-1 overflow-y-auto p-3">
                        {activeRootTab === "Recycle Bin" ? (
                          recycledFolders.length === 0 ? (
                            <div className="flex h-full min-h-[160px] flex-col items-center justify-center text-center text-xs text-slate-400">
                              <Trash2 className="mb-2 h-5 w-5 text-slate-500" />
                              <p>Recycle Bin is empty.</p>
                              <p className="mt-1 text-slate-500">
                                Deleted folders are soft-deleted here via send2trash.
                              </p>
                            </div>
                          ) : (
                            <div className="divide-y divide-white/8">
                              {recycledFolders.map((rf) => (
                                <div
                                  key={rf.id}
                                  className="flex items-center justify-between gap-2 py-2 text-xs"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-slate-200">{rf.name}</p>
                                    <p className="text-[11px] text-slate-400">
                                      From {rf.originalRoot} · {rf.deletedAt}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => onRestoreRecycled(rf.id)}
                                    className="flex shrink-0 items-center gap-1 rounded-md border border-white/12 px-2 py-1 text-[11px] text-sky-300 hover:bg-white/10"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Restore
                                  </button>
                                </div>
                              ))}
                            </div>
                          )
                        ) : filteredFolders.length === 0 ? (
                          <div className="flex h-full min-h-[160px] flex-col items-center justify-center text-center text-xs text-slate-400">
                            <Folder className="mb-2 h-5 w-5 text-slate-500" />
                            <p>No folders in {activeRootTab}.</p>
                            <p className="mt-1 text-slate-500">
                              Ask {assistantName.trim() || "the assistant"} to create a folder here.
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {filteredFolders.map((folder) => (
                              <div
                                key={folder.id}
                                className="flex items-center gap-2.5 rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-2 transition-colors hover:bg-white/[0.07]"
                              >
                                <Folder className="h-4 w-4 shrink-0 text-amber-300/90" />
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium text-slate-100">
                                    {folder.name}
                                  </p>
                                  <p className="font-mono text-[10px] text-slate-400 tabular-nums">
                                    {folder.itemCount} items · {folder.createdAt}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="border-t border-white/8 px-3.5 py-2 text-[11px] text-slate-400">
                        C:\Users\Alex\{activeRootTab} · Traversal &amp; System32 paths blocked
                      </div>
                    </div>
                  )}

                  {/* Live Open App Windows — ONLY shown when at least one app is opened */}
                  {openApps.length > 0 && (
                    <div
                      className={`grid auto-rows-min grid-cols-1 gap-3 sm:grid-cols-2 ${
                        explorerOpen ? "lg:col-span-7" : "mx-auto w-full max-w-4xl"
                      }`}
                    >
                      {openApps.map((app) => {
                        const isBrowser = app.id === "chrome" || app.id === "edge";
                        return (
                          <motion.div
                            key={app.id}
                            initial={{ opacity: 0, scale: 0.96, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onFocusApp(app.id);
                            }}
                            className={`flex min-h-[210px] cursor-pointer flex-col overflow-hidden rounded-xl border bg-[#0D121C]/90 shadow-2xl backdrop-blur-xl transition-colors ${
                              focusedAppId === app.id
                                ? "border-sky-400/50"
                                : "border-white/14 hover:border-white/25"
                            }`}
                          >
                            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                              <div className="min-w-0">
                                <p className="truncate font-display text-xs font-semibold text-slate-100">
                                  {app.windowTitle}
                                </p>
                                <p className="font-mono text-[10px] text-slate-400">
                                  {app.processName}
                                  {isBrowser ? " · Click to work full-view (auto-hides assistant)" : ""}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCloseAppWindow(app.id);
                                }}
                                aria-label={`Close ${app.name}`}
                                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="flex-1 space-y-1.5 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                              {app.id === "chrome" && (
                                <form
                                  onClick={(e) => e.stopPropagation()}
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    if (chromeInput.trim()) {
                                      onNavigateChrome(chromeInput.trim());
                                      setChromeInput("");
                                    }
                                  }}
                                  className="mb-2 flex items-center gap-1.5"
                                >
                                  <input
                                    type="text"
                                    value={chromeInput}
                                    onFocus={() => onFocusApp("chrome")}
                                    onChange={(e) => setChromeInput(e.target.value)}
                                    placeholder={app.browserUrl || "https://www.google.com"}
                                    className="h-7 flex-1 rounded-md border border-white/12 bg-slate-950/90 px-2.5 font-sans text-[11px] text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                                  />
                                  <button
                                    type="submit"
                                    className="h-7 rounded-md bg-sky-500/20 px-2 font-sans text-[11px] font-medium text-sky-200 hover:bg-sky-500/30"
                                  >
                                    Go
                                  </button>
                                </form>
                              )}
                              {app.previewLines.map((line, i) => (
                                <p key={i} className="truncate">
                                  {line}
                                </p>
                              ))}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Conditional Air-Mouse & Emergency Stop Overlay (ONLY shown when active) */}
                {(airMouseEnabled || isPatrolling) && (
                  <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-400/30 bg-[#0B1220]/92 px-3.5 py-2.5 backdrop-blur-xl">
                    <div className="flex items-center gap-2 text-xs text-slate-200">
                      <Hand className="h-4 w-4 text-sky-400" />
                      <span className="font-medium">
                        {airMouseEnabled ? "MediaPipe Air-Mouse Active" : "Keep-Awake Mouse Patrol Active"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {airMouseEnabled && (
                        <>
                          <button
                            type="button"
                            onClick={() => onTriggerGesture("Pointing_Up")}
                            className="rounded-md border border-white/12 bg-white/6 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/12"
                          >
                            Pointing_Up
                          </button>
                          <button
                            type="button"
                            onClick={() => onTriggerGesture("Thumb_Up")}
                            className="rounded-md border border-white/12 bg-white/6 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/12"
                          >
                            Thumb_Up
                          </button>
                          <button
                            type="button"
                            onClick={() => onTriggerGesture("Thumb_Down")}
                            className="rounded-md border border-white/12 bg-white/6 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/12"
                          >
                            Thumb_Down
                          </button>
                          <button
                            type="button"
                            onClick={() => onTriggerGesture("Closed_Fist")}
                            className="rounded-md border border-amber-400/30 bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/25"
                          >
                            Closed_Fist (Lock)
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={onEmergencyStop}
                        className="flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
                      >
                        <OctagonAlert className="h-3.5 w-3.5" />
                        Emergency Stop (Esc)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Live Autonomous Cubic-Eased Cursor Overlay (ONLY when patrolling, air-mouse, or clicking) */}
            {(isPatrolling || airMouseEnabled || clickRipple) && (
              <motion.div
                animate={{ left: `${cursorPos.x}%`, top: `${cursorPos.y}%` }}
                transition={{ duration: 0.42, ease: [0.65, 0, 0.35, 1] }}
                className="pointer-events-none absolute z-30 -translate-x-1 -translate-y-1"
              >
                <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
                  <path
                    d="M2 2L17 11.5L10.2 13.2L7.2 20L2 2Z"
                    fill="#F8FAFC"
                    stroke="#0F172A"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
                {isPatrolling && (
                  <span className="ml-3 rounded bg-slate-950/85 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
                    Patrol
                  </span>
                )}
              </motion.div>
            )}

            {/* Click Ripple Feedback */}
            {clickRipple && (
              <motion.div
                key={clickRipple.id}
                initial={{ opacity: 0.85, scale: 0.3 }}
                animate={{ opacity: 0, scale: 2.2 }}
                transition={{ duration: 0.45 }}
                style={{ left: `${clickRipple.x}%`, top: `${clickRipple.y}%` }}
                className="pointer-events-none absolute z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-400"
              />
            )}
          </div>
        )}

        {/* WINDOWS 11 LOCK SCREEN OVERLAY (Session-0 Voice Unlock Active) */}
        {isLocked && (
          <div className="relative z-20 flex h-full flex-col items-center justify-center px-4 pb-8 pt-20 text-center">
            <p className="font-display text-6xl font-semibold tracking-tight text-white tabular-nums">
              {formattedClock}
            </p>
            <p className="mt-1 text-sm text-slate-200">{formattedDate}</p>

            <div className="mt-7 w-full max-w-md rounded-2xl border border-white/15 bg-[#0A0F19]/84 p-5 text-left shadow-2xl backdrop-blur-2xl">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-white">
                  Session-0 2FA Voice Unlock
                </h3>
                <span className="font-mono text-[11px] text-slate-400">
                  \\.\pipe\WindowsNotchUnlock
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Requires both PBKDF2-HMAC-SHA256 passphrase and offline MFCC voiceprint match
                (threshold {vault.voiceprintThreshold.toFixed(2)}). Default demo passphrase:{" "}
                <code className="font-mono text-sky-300">notch-2026</code>
              </p>

              <form onSubmit={handleUnlockSubmit} className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Spoken / Entered Passphrase
                  </label>
                  <input
                    type="password"
                    value={unlockPassphrase}
                    onChange={(e) => setUnlockPassphrase(e.target.value)}
                    placeholder="Enter passphrase (e.g. notch-2026)"
                    disabled={lockoutRemaining > 0}
                    className="h-9 w-full rounded-lg border border-white/14 bg-slate-950/80 px-3 text-xs text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none disabled:opacity-50"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300">Speaker Voiceprint Sample</span>
                  <div className="flex items-center gap-1 rounded-lg bg-white/6 p-0.5">
                    <button
                      type="button"
                      onClick={() => setSpeakerMode("owner")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        speakerMode === "owner"
                          ? "bg-sky-500 text-slate-950"
                          : "text-slate-300 hover:text-white"
                      }`}
                    >
                      Enrolled Owner
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpeakerMode("impostor")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        speakerMode === "impostor"
                          ? "bg-rose-500 text-white"
                          : "text-slate-300 hover:text-white"
                      }`}
                    >
                      Test Impostor
                    </button>
                  </div>
                </div>

                {lockoutRemaining > 0 && (
                  <div className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
                    Brute-force lockout active: retry in{" "}
                    <span className="font-mono font-semibold tabular-nums">
                      {lockoutRemaining}s
                    </span>
                    . Intruder snapshot logged.
                  </div>
                )}

                {unlockFeedback && !unlockFeedback.ok && lockoutRemaining === 0 && (
                  <div className="rounded-lg border border-amber-500/35 bg-amber-500/12 px-3 py-2 text-xs text-amber-200">
                    {unlockFeedback.message} · Cosine similarity{" "}
                    <span className="font-mono tabular-nums">
                      {unlockFeedback.similarity.toFixed(2)}
                    </span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={lockoutRemaining > 0}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-sky-400 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Unlock className="h-3.5 w-3.5" />
                  Verify 2FA &amp; Submit to Winlogon
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
  );
};
