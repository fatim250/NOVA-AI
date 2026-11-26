import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Code2,
  Download,
  FileText,
  History,
  Lock,
  Monitor,
  Shield,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  AuditCategory,
  AuditEvent,
  DesktopApp,
  GroundingSource,
  MemoryInteraction,
  NotchAIResponse,
  RecycledFolder,
  SandboxRoot,
  SongTrack,
  VaultState,
  VirtualFolder,
} from "./types/notch";
import { DesktopSimulator } from "./components/DesktopSimulator";
import { MemoryBufferView } from "./components/MemoryBufferView";
import { AuditLogView } from "./components/AuditLogView";
import { SourceCodeView, downloadWindowsNotchZip } from "./components/SourceCodeView";
import { SecurityVaultModal } from "./components/SecurityVaultModal";
import type { LiveVoiceStatus, OrbState } from "./components/DynamicNotch";
import type { NotchSubView } from "./components/NotchBentoSubViews";
import { LiveVoiceSession } from "./utils/liveVoiceClient";
import {
  cosineSimilarity,
  generateSyntheticVoiceprint,
  hashPassphrasePBKDF2,
  sealCredentialEnvelope,
  sha256ShortHex,
  verifyPassphrasePBKDF2,
} from "./utils/cryptoVault";
import {
  MEMORY_WINDOW_SIZE,
  appendMemoryInteraction,
  deriveMemorySummary,
} from "./utils/memoryBuffer";
import { isProtectedSystemProcess, validateSandboxedFolder } from "./utils/sandboxEngine";

type WorkspaceTab = "desktop" | "memory" | "audit" | "source";

const INITIAL_FOLDERS: VirtualFolder[] = [
  { id: "f-1", name: "Design Specs", root: "Desktop", createdAt: "09:14", itemCount: 4 },
  { id: "f-2", name: "Release Notes", root: "Desktop", createdAt: "10:02", itemCount: 2 },
  { id: "f-3", name: "Contracts 2026", root: "Documents", createdAt: "Yesterday", itemCount: 7 },
  { id: "f-4", name: "Installers", root: "Downloads", createdAt: "Yesterday", itemCount: 3 },
];

const INITIAL_APPS: DesktopApp[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    processName: "chrome.exe",
    isOpen: false,
    windowTitle: "Google Chrome — New Tab",
    browserUrl: "https://www.google.com",
    previewLines: [
      "https://www.google.com",
      "Ready — Ask the assistant to open any site or search right here.",
    ],
    x: 30,
    y: 30,
    zIndex: 2,
  },
  {
    id: "vscode",
    name: "VS Code",
    processName: "Code.exe",
    isOpen: true,
    windowTitle: "Visual Studio Code — windows_notch_pro",
    previewLines: [
      "def enable_per_monitor_v2_dpi() -> None:",
      "    ctypes.windll.user32.SetProcessDpiAwarenessContext(-4)",
      "# ShortTermMemoryBuffer(maxlen=20) active",
    ],
    x: 40,
    y: 40,
    zIndex: 1,
  },
  {
    id: "notepad",
    name: "Notepad",
    processName: "notepad.exe",
    isOpen: false,
    windowTitle: "Notepad — Meeting Notes.txt",
    previewLines: [
      "Q4 Launch Checklist",
      "- Verify PBKDF2 200k vault derivation",
      "- Package standalone WindowsNotchPro.exe",
    ],
    x: 60,
    y: 60,
    zIndex: 1,
  },
  {
    id: "calculator",
    name: "Calculator",
    processName: "CalculatorApp.exe",
    isOpen: false,
    windowTitle: "Calculator — Standard",
    previewLines: ["Memory: 0", "200,000 × PBKDF2-HMAC-SHA256", "Result: 0.00"],
    x: 80,
    y: 80,
    zIndex: 1,
  },
  {
    id: "terminal",
    name: "Terminal",
    processName: "WindowsTerminal.exe",
    isOpen: false,
    windowTitle: "Windows Terminal — PowerShell 7",
    previewLines: [
      "PS C:\\WindowsNotchPro> python -m unittest discover -s tests -v",
      "Ran 5 tests in 0.142s — OK",
    ],
    x: 100,
    y: 100,
    zIndex: 1,
  },
  {
    id: "edge",
    name: "Edge",
    processName: "msedge.exe",
    isOpen: false,
    windowTitle: "Microsoft Edge — Architecture Docs",
    previewLines: [
      "https://learn.microsoft.com/windows/win32/secauthn/credential-providers",
      "ICredentialProvider · Named Pipe DACL SDDL reference",
    ],
    x: 120,
    y: 120,
    zIndex: 1,
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("desktop");
  const [vaultModalOpen, setVaultModalOpen] = useState(false);

  // Assistant Identity (defaults to NOVA; user can rename or clear anytime) & Bento UI State
  const [assistantName, setAssistantName] = useState("NOVA");
  const [focusedAppId, setFocusedAppId] = useState<string | null>(null);
  const [notchExpanded, setNotchExpanded] = useState(false);
  const [activeNotchView, setActiveNotchView] = useState<NotchSubView>("bento");
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [liveStatus, setLiveStatus] = useState<LiveVoiceStatus>("disconnected");
  const [liveInputTranscript, setLiveInputTranscript] = useState("");
  const [liveOutputTranscript, setLiveOutputTranscript] = useState("");
  const [ttsMuted, setTtsMuted] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [lastReply, setLastReply] = useState(
    "Ready. Click Mic for real-time voice, open Chrome, play a song, or give me a name whenever you like."
  );
  const [lastResolvedRef, setLastResolvedRef] = useState("");
  const [lastSources, setLastSources] = useState<GroundingSource[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [retryableError, setRetryableError] = useState(false);

  // Desktop Simulator State
  const [isLocked, setIsLocked] = useState(false);
  const [folders, setFolders] = useState<VirtualFolder[]>(INITIAL_FOLDERS);
  const [recycledFolders, setRecycledFolders] = useState<RecycledFolder[]>([]);
  const [apps, setApps] = useState<DesktopApp[]>(INITIAL_APPS);
  const [cursorPos, setCursorPos] = useState({ x: 56, y: 52 });
  const [clickRipple, setClickRipple] = useState<{ x: number; y: number; id: number } | null>(null);
  const [isPatrolling, setIsPatrolling] = useState(false);
  const [airMouseEnabled, setAirMouseEnabled] = useState(false);
  const [volume, setVolume] = useState(64);

  // In-Notch Song Search & Playback State
  const [currentTrack, setCurrentTrack] = useState<SongTrack | null>(null);
  const [isTrackPlaying, setIsTrackPlaying] = useState(false);
  const [trackProgress, setTrackProgress] = useState(0);
  const [songResults, setSongResults] = useState<SongTrack[]>([]);

  // 20-Turn Sliding Window Short-Term Memory
  const [memoryEntries, setMemoryEntries] = useState<MemoryInteraction[]>([]);
  const [totalMemoryRecorded, setTotalMemoryRecorded] = useState(0);

  // Structured Audit Log (audit.jsonl)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([
    {
      id: "audit-boot",
      timestamp: new Date().toISOString(),
      category: "system",
      event: "notch_initialized",
      status: "allowed",
      detail: "Per-Monitor V2 DPI · DWM rounded corners · 20-turn sliding memory buffer ready",
      actor: "notch_ai",
      prevHash: "0000000000000000",
      entryHash: "4e9b21a7c3d018f2",
    },
  ]);

  // Security Vault State (initialized with real PBKDF2-HMAC-SHA256 hash of demo passphrase "notch-2026")
  const [vault, setVault] = useState<VaultState>({
    passphraseConfigured: true,
    passphraseSaltHex: "",
    passphraseHashHex: "deriving...",
    pbkdf2Iterations: 200_000,
    windowsAccount: ".\\Alex",
    dpapiBlobPreview: "DPAPI-V1::initializing...",
    voiceprintEnrolled: true,
    voiceprintVector: generateSyntheticVoiceprint("owner"),
    voiceprintThreshold: 0.82,
    voiceprintEnrolledAt: "Session Init",
    failedAttempts: 0,
    lockoutUntil: null,
    captureIntruderSnapshot: true,
    lastIntruderSnapshotAt: null,
  });

  const liveSessionRef = useRef<LiveVoiceSession | null>(null);
  const liveInputAccRef = useRef<string>("");
  const liveOutputAccRef = useRef<string>("");
  const lastPromptRef = useRef<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const patrolTimerRef = useRef<number | null>(null);
  const browserHideTimerRef = useRef<number | null>(null);
  const lastHashRef = useRef<string>("4e9b21a7c3d018f2");

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audio.ontimeupdate = () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        setTrackProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    audio.onended = () => {
      setIsTrackPlaying(false);
      setTrackProgress(100);
    };
    audio.onerror = () => {
      setIsTrackPlaying(false);
    };
    audioRef.current = audio;

    return () => {
      liveSessionRef.current?.stop();
      if (browserHideTimerRef.current) {
        window.clearTimeout(browserHideTimerRef.current);
      }
      audio.pause();
      audio.src = "";
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, volume / 100));
    }
  }, [volume]);

  // Initialize real PBKDF2 hash & DPAPI envelope on mount
  useEffect(() => {
    let active = true;
    (async () => {
      const hashed = await hashPassphrasePBKDF2("notch-2026");
      const blob = await sealCredentialEnvelope(".\\Alex", "demo-windows-session-secret");
      if (!active) return;
      setVault((prev) => ({
        ...prev,
        passphraseSaltHex: hashed.saltHex,
        passphraseHashHex: hashed.hashHex,
        pbkdf2Iterations: hashed.iterations,
        dpapiBlobPreview: blob,
      }));
    })();
    return () => {
      active = false;
    };
  }, []);

  // Keep-awake autonomous mouse patrol loop
  useEffect(() => {
    if (!isPatrolling || isLocked) {
      if (patrolTimerRef.current) {
        window.clearInterval(patrolTimerRef.current);
        patrolTimerRef.current = null;
      }
      return;
    }
    const waypoints = [
      { x: 34, y: 42 },
      { x: 68, y: 42 },
      { x: 64, y: 66 },
      { x: 38, y: 64 },
    ];
    let idx = 0;
    patrolTimerRef.current = window.setInterval(() => {
      idx = (idx + 1) % waypoints.length;
      setCursorPos(waypoints[idx]);
    }, 1800);
    return () => {
      if (patrolTimerRef.current) {
        window.clearInterval(patrolTimerRef.current);
        patrolTimerRef.current = null;
      }
    };
  }, [isPatrolling, isLocked]);

  const appendAudit = useCallback(
    async (
      category: AuditCategory,
      event: string,
      status: AuditEvent["status"],
      detail: string,
      actor = "notch_ai"
    ) => {
      const timestamp = new Date().toISOString();
      const prevHash = lastHashRef.current;
      const entryHash = await sha256ShortHex(
        `${timestamp}|${category}|${event}|${status}|${detail}|${prevHash}`
      );
      lastHashRef.current = entryHash;
      setAuditEvents((prev) => [
        {
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp,
          category,
          event,
          status,
          detail,
          actor,
          prevHash,
          entryHash,
        },
        ...prev,
      ]);
    },
    []
  );

  const speakTalkBack = useCallback(
    (text: string) => {
      if (ttsMuted || typeof window === "undefined" || !("speechSynthesis" in window)) {
        setOrbState(isLocked ? "locked" : "idle");
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.04;
        utterance.pitch = 1.0;
        utterance.onstart = () => setOrbState("speaking");
        utterance.onend = () => setOrbState(isLocked ? "locked" : "idle");
        utterance.onerror = () => setOrbState(isLocked ? "locked" : "idle");
        window.speechSynthesis.speak(utterance);
      } catch {
        setOrbState(isLocked ? "locked" : "idle");
      }
    },
    [ttsMuted, isLocked]
  );

  const recordToMemory = useCallback(
    (
      userInput: string,
      action: NotchAIResponse["action"],
      assistantReply: string,
      outcome: MemoryInteraction["outcome"],
      meta?: { target?: string; newName?: string; root?: SandboxRoot; resolvedReference?: string }
    ) => {
      setMemoryEntries((prev) => {
        const res = appendMemoryInteraction(
          prev,
          {
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            userInput,
            action,
            target: meta?.target,
            newName: meta?.newName,
            root: meta?.root,
            resolvedReference: meta?.resolvedReference || undefined,
            assistantReply,
            outcome,
          },
          totalMemoryRecorded
        );
        setTotalMemoryRecorded(res.totalRecorded);
        return res.entries;
      });
    },
    [totalMemoryRecorded]
  );

  const handleAttempt2FAUnlock = useCallback(
    async (
      passphrase: string,
      speakerMode: "owner" | "impostor"
    ): Promise<{ ok: boolean; message: string; similarity: number }> => {
      const now = Date.now();
      if (vault.lockoutUntil && vault.lockoutUntil > now) {
        const secs = Math.ceil((vault.lockoutUntil - now) / 1000);
        const msg = `Rate-limited for ${secs}s after repeated failed attempts.`;
        await appendAudit("security", "unlock_blocked_lockout", "blocked", msg, "session0_service");
        return { ok: false, message: msg, similarity: 0 };
      }

      const probeVec = generateSyntheticVoiceprint(
        speakerMode === "owner" ? "owner_verify" : "impostor"
      );
      const similarity = cosineSimilarity(vault.voiceprintVector, probeVec);
      const voiceOk = vault.voiceprintEnrolled && similarity >= vault.voiceprintThreshold;
      const passOk = await verifyPassphrasePBKDF2(
        passphrase,
        vault.passphraseSaltHex,
        vault.passphraseHashHex
      );

      if (passOk && voiceOk) {
        setVault((prev) => ({ ...prev, failedAttempts: 0, lockoutUntil: null }));
        setIsLocked(false);
        setOrbState("idle");
        const okMsg = `Unlocked via Session-0 Named Pipe (voice similarity ${similarity.toFixed(2)}).`;
        setLastReply(okMsg);
        speakTalkBack("Welcome back. Workstation unlocked with two-factor voice verification.");
        await appendAudit("security", "unlock_2fa_success", "allowed", okMsg, "session0_service");
        return { ok: true, message: okMsg, similarity };
      }

      const nextFailures = vault.failedAttempts + 1;
      const reason = !passOk
        ? "Passphrase mismatch"
        : `Voiceprint impostor rejected (${similarity.toFixed(2)} < ${vault.voiceprintThreshold.toFixed(2)})`;

      if (nextFailures >= 3) {
        const lockoutUntil = now + 60_000;
        setVault((prev) => ({
          ...prev,
          failedAttempts: 0,
          lockoutUntil,
          lastIntruderSnapshotAt: prev.captureIntruderSnapshot
            ? new Date().toLocaleTimeString()
            : prev.lastIntruderSnapshotAt,
        }));
        const lockMsg = `${reason}. 3 failed attempts — locked out for 60 seconds.`;
        await appendAudit(
          "security",
          "unlock_brute_force_lockout",
          "blocked",
          `${lockMsg}${vault.captureIntruderSnapshot ? " Intruder webcam snapshot captured." : ""}`,
          "session0_service"
        );
        speakTalkBack("Access denied. Three failed attempts triggered a sixty second security lockout.");
        return { ok: false, message: lockMsg, similarity };
      }

      setVault((prev) => ({ ...prev, failedAttempts: nextFailures }));
      const failMsg = `${reason} (${nextFailures}/3 attempts).`;
      await appendAudit("security", "unlock_2fa_failed", "blocked", failMsg, "session0_service");
      speakTalkBack(reason);
      return { ok: false, message: failMsg, similarity };
    },
    [vault, appendAudit, speakTalkBack]
  );

  const handleEmergencyStop = useCallback(() => {
    setIsPatrolling(false);
    setAirMouseEnabled(false);
    const msg = "Emergency stop engaged. Mouse patrol and Air-Mouse halted.";
    setLastReply(msg);
    setLastResolvedRef("");
    appendAudit("mouse", "emergency_stop", "warning", msg);
    speakTalkBack(msg);
  }, [appendAudit, speakTalkBack]);

  const handleTriggerGesture = useCallback(
    (gesture: "Pointing_Up" | "Closed_Fist" | "Thumb_Up" | "Thumb_Down") => {
      if (gesture === "Pointing_Up") {
        const nx = 22 + Math.round(Math.random() * 58);
        const ny = 24 + Math.round(Math.random() * 50);
        setCursorPos({ x: nx, y: ny });
        setLastReply(`Air-Mouse Pointing_Up tracked with EMA smoothing to (${nx}%, ${ny}%).`);
        appendAudit("mouse", "gesture_pointing_up", "allowed", `EMA cursor -> (${nx}%, ${ny}%)`);
      } else if (gesture === "Thumb_Up") {
        setVolume((v) => Math.min(100, v + 10));
        setLastReply("Gesture Thumb_Up detected. System volume raised.");
        appendAudit("mouse", "gesture_thumb_up", "allowed", "Volume +10%");
      } else if (gesture === "Thumb_Down") {
        setVolume((v) => Math.max(0, v - 10));
        setLastReply("Gesture Thumb_Down detected. System volume lowered.");
        appendAudit("mouse", "gesture_thumb_down", "allowed", "Volume -10%");
      } else if (gesture === "Closed_Fist") {
        setAirMouseEnabled(false);
        setIsPatrolling(false);
        setIsLocked(true);
        setOrbState("locked");
        setLastReply("Gesture Closed_Fist detected. Workstation locked; Session-0 voice active.");
        appendAudit("security", "gesture_closed_fist_lock", "allowed", "LockWorkStation()");
        speakTalkBack("Workstation locked via Closed Fist gesture.");
      }
    },
    [appendAudit, speakTalkBack]
  );

  const playTrackInNotch = useCallback(
    async (track: SongTrack) => {
      const audio = audioRef.current;
      if (!audio) return;
      try {
        audio.pause();
        audio.src = track.previewUrl;
        audio.currentTime = 0;
        audio.volume = Math.max(0, Math.min(1, volume / 100));
        setCurrentTrack(track);
        setTrackProgress(0);
        await audio.play();
        setIsTrackPlaying(true);
        await appendAudit(
          "system",
          "notch_song_play",
          "allowed",
          `${track.title} — ${track.artist}`
        );
      } catch {
        setIsTrackPlaying(false);
        setLastError("Browser blocked autoplay. Click Play on the Notch player to start audio.");
      }
    },
    [volume, appendAudit]
  );

  const handleTogglePlayPause = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isTrackPlaying) {
      audio.pause();
      setIsTrackPlaying(false);
    } else {
      try {
        await audio.play();
        setIsTrackPlaying(true);
      } catch {
        setIsTrackPlaying(false);
      }
    }
  }, [currentTrack, isTrackPlaying]);

  const handleStopTrack = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    }
    setIsTrackPlaying(false);
    setTrackProgress(0);
    setCurrentTrack(null);
    appendAudit("system", "notch_song_stop", "allowed", "Stopped in-Notch audio playback");
  }, [appendAudit]);

  const handleNextTrack = useCallback(() => {
    if (songResults.length === 0) return;
    const idx = currentTrack ? songResults.findIndex((t) => t.id === currentTrack.id) : -1;
    const next = songResults[(idx + 1) % songResults.length];
    if (next) void playTrackInNotch(next);
  }, [songResults, currentTrack, playTrackInNotch]);

  const handlePrevTrack = useCallback(() => {
    if (songResults.length === 0) return;
    const idx = currentTrack ? songResults.findIndex((t) => t.id === currentTrack.id) : 0;
    const prev = songResults[(idx - 1 + songResults.length) % songResults.length];
    if (prev) void playTrackInNotch(prev);
  }, [songResults, currentTrack, playTrackInNotch]);

  const handleSearchSongsDirect = useCallback(
    async (query: string) => {
      try {
        const res = await fetch(`/api/music/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        const tracks: SongTrack[] = Array.isArray(data?.tracks) ? data.tracks : [];
        setSongResults(tracks);
        if (tracks.length > 0) {
          await playTrackInNotch(tracks[0]);
          setLastReply(`Playing ${tracks[0].title} by ${tracks[0].artist} in NOVA Media.`);
          await appendAudit("system", "notch_song_search", "allowed", `Direct search "${query}" -> ${tracks[0].title}`);
        }
      } catch {
        setLastError("Could not reach song catalog right now.");
      }
    },
    [playTrackInNotch, appendAudit]
  );

  const handleToggleKeepAwake = useCallback(() => {
    setIsPatrolling((prev) => {
      const next = !prev;
      const msg = next
        ? "Coffee Keep-Awake enabled — autonomous mouse patrol active."
        : "Coffee Keep-Awake disabled — mouse patrol stopped.";
      setLastReply(msg);
      appendAudit("mouse", next ? "coffee_keep_awake_on" : "coffee_keep_awake_off", "allowed", msg);
      return next;
    });
  }, [appendAudit]);

  const handleToggleAirMouse = useCallback(() => {
    setAirMouseEnabled((prev) => {
      const next = !prev;
      const msg = next ? "MediaPipe Air-Mouse enabled." : "MediaPipe Air-Mouse disabled.";
      setLastReply(msg);
      appendAudit("mouse", next ? "air_mouse_enabled" : "air_mouse_disabled", "allowed", msg);
      return next;
    });
  }, [appendAudit]);

  const handleOpenAppWindow = useCallback(
    (appId: string) => {
      const target = apps.find((a) => a.id === appId);
      if (!target) return;
      setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, isOpen: true } : a)));
      if (appId === "chrome" || appId === "edge") {
        setFocusedAppId(appId);
        setNotchExpanded(false);
      }
      appendAudit("app", "app_open", "allowed", `Launched ${target.processName} from System Monitor`);
    },
    [apps, appendAudit]
  );

  const handleAttemptProtectedProcess = useCallback(
    (procName: string) => {
      const msg = `Blocked: ${procName} is a protected critical Windows process and cannot be terminated.`;
      setLastReply(msg);
      appendAudit("app", "app_close_protected", "blocked", msg);
      speakTalkBack(msg);
    },
    [appendAudit, speakTalkBack]
  );

  const handleNavigateChrome = useCallback(
    (queryOrUrl: string) => {
      const trimmed = queryOrUrl.trim();
      const isUrl = /^https?:\/\//i.test(trimmed) || /^[a-z0-9-]+(\.[a-z]{2,})/i.test(trimmed);
      const formattedUrl = isUrl
        ? trimmed.startsWith("http")
          ? trimmed
          : `https://${trimmed}`
        : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;

      setApps((prev) =>
        prev.map((a) =>
          a.id === "chrome"
            ? {
                ...a,
                isOpen: true,
                browserUrl: formattedUrl,
                windowTitle: `Google Chrome — ${trimmed}`,
                previewLines: [
                  formattedUrl,
                  isUrl
                    ? `Loaded ${formattedUrl} inside Chrome.`
                    : `Google Search results for "${trimmed}"`,
                  "Sandboxed Chrome launcher active (shell=False)",
                ],
              }
            : a
        )
      );
      setFocusedAppId("chrome");
      appendAudit("app", "chrome_navigate", "allowed", formattedUrl);
    },
    [appendAudit]
  );

  const executeNotchIntent = useCallback(
    async (rawPrompt: string, parsed: NotchAIResponse) => {
      const refNote = parsed.resolvedReference?.trim() ?? "";
      setLastResolvedRef(refNote);
      setLastSources(Array.isArray(parsed.sources) ? parsed.sources : []);
      setLastError(null);
      setRetryableError(false);

      if (refNote) {
        await appendAudit("memory", "relative_reference_resolved", "allowed", refNote);
      }

      switch (parsed.action) {
        case "folder_create": {
          const check = validateSandboxedFolder(parsed.target, parsed.root);
          if (!check.allowed) {
            const msg = check.reason ?? "Folder creation blocked by sandbox policy.";
            setLastReply(msg);
            recordToMemory(rawPrompt, "folder_create", msg, "blocked", {
              target: parsed.target,
              resolvedReference: refNote,
            });
            await appendAudit("folder", "folder_create", "blocked", msg);
            speakTalkBack(msg);
            return;
          }
          const exists = folders.some(
            (f) =>
              f.root === check.normalizedRoot &&
              f.name.toLowerCase() === check.sanitizedName.toLowerCase()
          );
          if (exists) {
            const msg = `Folder "${check.sanitizedName}" already exists in ${check.normalizedRoot}.`;
            setLastReply(msg);
            recordToMemory(rawPrompt, "folder_create", msg, "blocked", {
              target: check.sanitizedName,
              root: check.normalizedRoot,
              resolvedReference: refNote,
            });
            speakTalkBack(msg);
            return;
          }
          const created: VirtualFolder = {
            id: `f-${Date.now()}`,
            name: check.sanitizedName,
            root: check.normalizedRoot,
            createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            itemCount: 0,
          };
          setFolders((prev) => [created, ...prev]);
          const reply =
            parsed.spokenReply ||
            `Created folder ${check.sanitizedName} in ${check.normalizedRoot}.`;
          setLastReply(reply);
          recordToMemory(rawPrompt, "folder_create", reply, "executed", {
            target: check.sanitizedName,
            root: check.normalizedRoot,
            resolvedReference: refNote,
          });
          await appendAudit(
            "folder",
            "folder_create",
            "allowed",
            `${check.normalizedRoot}\\${check.sanitizedName}`
          );
          speakTalkBack(reply);
          return;
        }

        case "folder_rename": {
          const oldCheck = validateSandboxedFolder(parsed.target, parsed.root);
          const newCheck = validateSandboxedFolder(parsed.newName, parsed.root);
          if (!oldCheck.allowed || !newCheck.allowed) {
            const msg = oldCheck.reason || newCheck.reason || "Rename blocked by sandbox.";
            setLastReply(msg);
            recordToMemory(rawPrompt, "folder_rename", msg, "blocked", {
              target: parsed.target,
              newName: parsed.newName,
              resolvedReference: refNote,
            });
            await appendAudit("folder", "folder_rename", "blocked", msg);
            speakTalkBack(msg);
            return;
          }
          const targetFolder = folders.find(
            (f) => f.name.toLowerCase() === oldCheck.sanitizedName.toLowerCase()
          );
          if (!targetFolder) {
            const msg = `Could not find folder "${oldCheck.sanitizedName}" in approved roots.`;
            setLastReply(msg);
            recordToMemory(rawPrompt, "folder_rename", msg, "blocked", {
              target: oldCheck.sanitizedName,
              resolvedReference: refNote,
            });
            speakTalkBack(msg);
            return;
          }
          setFolders((prev) =>
            prev.map((f) =>
              f.id === targetFolder.id ? { ...f, name: newCheck.sanitizedName } : f
            )
          );
          const reply =
            parsed.spokenReply ||
            `Renamed ${targetFolder.name} to ${newCheck.sanitizedName} in ${targetFolder.root}.`;
          setLastReply(reply);
          recordToMemory(rawPrompt, "folder_rename", reply, "executed", {
            target: targetFolder.name,
            newName: newCheck.sanitizedName,
            root: targetFolder.root,
            resolvedReference: refNote,
          });
          await appendAudit(
            "folder",
            "folder_rename",
            "allowed",
            `${targetFolder.root}\\${targetFolder.name} -> ${newCheck.sanitizedName}`
          );
          speakTalkBack(reply);
          return;
        }

        case "folder_delete": {
          const check = validateSandboxedFolder(parsed.target, parsed.root);
          if (!check.allowed) {
            const msg = check.reason ?? "Folder delete blocked by sandbox policy.";
            setLastReply(msg);
            recordToMemory(rawPrompt, "folder_delete", msg, "blocked", {
              target: parsed.target,
              resolvedReference: refNote,
            });
            await appendAudit("folder", "folder_delete", "blocked", msg);
            speakTalkBack(msg);
            return;
          }
          const match = folders.find(
            (f) => f.name.toLowerCase() === check.sanitizedName.toLowerCase()
          );
          if (!match) {
            const msg = `Folder "${check.sanitizedName}" was not found.`;
            setLastReply(msg);
            recordToMemory(rawPrompt, "folder_delete", msg, "blocked", {
              target: check.sanitizedName,
              resolvedReference: refNote,
            });
            speakTalkBack(msg);
            return;
          }
          setFolders((prev) => prev.filter((f) => f.id !== match.id));
          setRecycledFolders((prev) => [
            {
              id: match.id,
              name: match.name,
              originalRoot: match.root,
              deletedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
            ...prev,
          ]);
          const reply =
            parsed.spokenReply || `Moved ${match.name} to the Recycle Bin via send2trash.`;
          setLastReply(reply);
          recordToMemory(rawPrompt, "folder_delete", reply, "executed", {
            target: match.name,
            root: match.root,
            resolvedReference: refNote,
          });
          await appendAudit(
            "folder",
            "folder_soft_delete",
            "allowed",
            `Recycle Bin <- ${match.root}\\${match.name}`
          );
          speakTalkBack(reply);
          return;
        }

        case "app_open": {
          const query = (parsed.target ?? "").trim().toLowerCase();
          const isBrowserAlias =
            query.includes("chrome") || query === "browser" || query === "web browser";
          const match = isBrowserAlias
            ? apps.find((a) => a.id === "chrome")
            : apps.find(
                (a) =>
                  a.name.toLowerCase().includes(query) ||
                  a.processName.toLowerCase().includes(query) ||
                  query.includes(a.name.toLowerCase())
              );
          if (!match) {
            const msg = `Application "${parsed.target || "unknown"}" is not in the approved launcher allowlist.`;
            setLastReply(msg);
            recordToMemory(rawPrompt, "app_open", msg, "blocked", {
              target: parsed.target,
              resolvedReference: refNote,
            });
            await appendAudit("app", "app_open", "blocked", msg);
            speakTalkBack(msg);
            return;
          }
          if (match.id === "chrome" && (parsed.url || parsed.searchQuery)) {
            handleNavigateChrome(parsed.url || parsed.searchQuery || "");
          } else {
            setApps((prev) => prev.map((a) => (a.id === match.id ? { ...a, isOpen: true } : a)));
          }
          if (match.id === "chrome" || match.id === "edge") {
            setFocusedAppId(match.id);
            if (browserHideTimerRef.current) {
              window.clearTimeout(browserHideTimerRef.current);
            }
            // Collapse cleanly after showing confirmation so browser tabs are 100% unobstructed
            browserHideTimerRef.current = window.setTimeout(() => {
              setNotchExpanded(false);
            }, 1500);
          }
          const reply =
            parsed.spokenReply ||
            (match.id === "chrome" || match.id === "edge"
              ? `Opened ${match.name}. I'll fade out while you browse — hover the top edge anytime.`
              : `Opened ${match.name} without shell execution.`);
          setLastReply(reply);
          recordToMemory(rawPrompt, "app_open", reply, "executed", {
            target: match.name,
            resolvedReference: refNote,
          });
          await appendAudit(
            "app",
            "app_open",
            "allowed",
            `Launched ${match.processName} (shell=False)`
          );
          speakTalkBack(reply);
          return;
        }

        case "set_assistant_name": {
          const rawTarget = (parsed.target ?? "").trim();
          const shouldClear =
            !rawTarget || /^(none|nameless|reset|clear|no name|nothing)$/i.test(rawTarget);
          const nextName = shouldClear ? "" : rawTarget.slice(0, 28);
          setAssistantName(nextName);
          const reply =
            parsed.spokenReply ||
            (nextName
              ? `Done — you can call me ${nextName}.`
              : "Okay, I've cleared my name and will stay nameless until you choose one.");
          setLastReply(reply);
          recordToMemory(rawPrompt, "set_assistant_name", reply, "executed", {
            target: nextName || "(nameless)",
            resolvedReference: refNote,
          });
          await appendAudit(
            "system",
            "assistant_renamed",
            "allowed",
            nextName ? `Assigned name: ${nextName}` : "Reset to nameless mode"
          );
          speakTalkBack(reply);
          return;
        }

        case "song_search": {
          const tracks = Array.isArray(parsed.songs) ? parsed.songs : [];
          setSongResults(tracks);
          const reply =
            parsed.spokenReply ||
            (tracks.length > 0
              ? `Found ${tracks.length} songs. Click Play on any track inside the Notch.`
              : "No playable songs matched that query.");
          setLastReply(reply);
          recordToMemory(rawPrompt, "song_search", reply, tracks.length > 0 ? "executed" : "answered", {
            target: parsed.searchQuery || parsed.target,
            resolvedReference: refNote,
          });
          await appendAudit(
            "system",
            "notch_song_search",
            "allowed",
            `query="${parsed.searchQuery || rawPrompt}" · ${tracks.length} results`
          );
          speakTalkBack(reply);
          return;
        }

        case "song_play": {
          const tracks = Array.isArray(parsed.songs) ? parsed.songs : [];
          setSongResults(tracks);
          if (tracks.length > 0) {
            const topTrack = tracks[0];
            const reply =
              parsed.spokenReply || `Playing ${topTrack.title} by ${topTrack.artist} in the Notch.`;
            setLastReply(reply);
            recordToMemory(rawPrompt, "song_play", reply, "executed", {
              target: `${topTrack.title} — ${topTrack.artist}`,
              resolvedReference: refNote,
            });
            await playTrackInNotch(topTrack);
          } else {
            const reply =
              parsed.spokenReply || "I could not find a playable song preview for that request.";
            setLastReply(reply);
            recordToMemory(rawPrompt, "song_play", reply, "blocked", {
              target: parsed.searchQuery || parsed.target,
              resolvedReference: refNote,
            });
            speakTalkBack(reply);
          }
          return;
        }

        case "song_pause": {
          if (audioRef.current && currentTrack && isTrackPlaying) {
            audioRef.current.pause();
            setIsTrackPlaying(false);
            const reply = parsed.spokenReply || `Paused ${currentTrack.title}.`;
            setLastReply(reply);
            recordToMemory(rawPrompt, "song_pause", reply, "executed", {
              target: currentTrack.title,
              resolvedReference: refNote,
            });
            await appendAudit("system", "notch_song_pause", "allowed", currentTrack.title);
            speakTalkBack(reply);
          } else {
            const reply = "No song is currently playing.";
            setLastReply(reply);
            speakTalkBack(reply);
          }
          return;
        }

        case "song_resume": {
          if (audioRef.current && currentTrack && !isTrackPlaying) {
            await audioRef.current.play().catch(() => {});
            setIsTrackPlaying(true);
            const reply = parsed.spokenReply || `Resumed ${currentTrack.title}.`;
            setLastReply(reply);
            recordToMemory(rawPrompt, "song_resume", reply, "executed", {
              target: currentTrack.title,
              resolvedReference: refNote,
            });
            await appendAudit("system", "notch_song_resume", "allowed", currentTrack.title);
          } else {
            const reply = "There is no paused song to resume.";
            setLastReply(reply);
            speakTalkBack(reply);
          }
          return;
        }

        case "song_stop": {
          const stoppedName = currentTrack?.title ?? "music";
          handleStopTrack();
          const reply = parsed.spokenReply || `Stopped ${stoppedName}.`;
          setLastReply(reply);
          recordToMemory(rawPrompt, "song_stop", reply, "executed", {
            target: stoppedName,
            resolvedReference: refNote,
          });
          speakTalkBack(reply);
          return;
        }

        case "app_close": {
          const targetProc = (parsed.target ?? "").trim();
          if (isProtectedSystemProcess(targetProc)) {
            const msg = `Blocked: ${targetProc} is a critical protected Windows process and cannot be terminated.`;
            setLastReply(msg);
            recordToMemory(rawPrompt, "app_close", msg, "blocked", {
              target: targetProc,
              resolvedReference: refNote,
            });
            await appendAudit("app", "app_close_protected", "blocked", msg);
            speakTalkBack(msg);
            return;
          }
          const lower = targetProc.toLowerCase();
          const match = apps.find(
            (a) =>
              a.name.toLowerCase().includes(lower) ||
              a.processName.toLowerCase().includes(lower) ||
              lower.includes(a.name.toLowerCase())
          );
          if (!match || !match.isOpen) {
            const msg = `${targetProc || "That app"} is not currently running.`;
            setLastReply(msg);
            recordToMemory(rawPrompt, "app_close", msg, "blocked", {
              target: targetProc,
              resolvedReference: refNote,
            });
            speakTalkBack(msg);
            return;
          }
          setApps((prev) => prev.map((a) => (a.id === match.id ? { ...a, isOpen: false } : a)));
          setFocusedAppId((prev) => (prev === match.id ? null : prev));
          const reply = parsed.spokenReply || `Closed ${match.name}.`;
          setLastReply(reply);
          recordToMemory(rawPrompt, "app_close", reply, "executed", {
            target: match.name,
            resolvedReference: refNote,
          });
          await appendAudit("app", "app_close", "allowed", `Terminated ${match.processName}`);
          speakTalkBack(reply);
          return;
        }

        case "app_list": {
          const running = apps.filter((a) => a.isOpen).map((a) => a.name);
          const reply =
            running.length > 0
              ? `Running desktop apps: ${running.join(", ")}. Critical Windows processes remain protected.`
              : "No user desktop apps are currently open.";
          setLastReply(reply);
          recordToMemory(rawPrompt, "app_list", reply, "executed", {
            resolvedReference: refNote,
          });
          await appendAudit("app", "app_list", "allowed", `count=${running.length}`);
          speakTalkBack(reply);
          return;
        }

        case "mouse_move": {
          let nx = typeof parsed.x === "number" ? Math.max(8, Math.min(92, parsed.x)) : cursorPos.x;
          let ny = typeof parsed.y === "number" ? Math.max(12, Math.min(86, parsed.y)) : cursorPos.y;
          if (parsed.direction === "center") {
            nx = 50;
            ny = 50;
          } else if (parsed.direction === "left") {
            nx = Math.max(12, cursorPos.x - 18);
          } else if (parsed.direction === "right") {
            nx = Math.min(88, cursorPos.x + 18);
          } else if (parsed.direction === "up") {
            ny = Math.max(16, cursorPos.y - 16);
          } else if (parsed.direction === "down") {
            ny = Math.min(84, cursorPos.y + 16);
          }
          setCursorPos({ x: nx, y: ny });
          const reply = parsed.spokenReply || `Moved cursor smoothly to (${nx}%, ${ny}%).`;
          setLastReply(reply);
          recordToMemory(rawPrompt, "mouse_move", reply, "executed", {
            target: `(${nx},${ny})`,
            resolvedReference: refNote,
          });
          await appendAudit("mouse", "mouse_move", "allowed", `Cubic ease-in-out -> (${nx}%, ${ny}%)`);
          speakTalkBack(reply);
          return;
        }

        case "mouse_click": {
          setClickRipple({ x: cursorPos.x, y: cursorPos.y, id: Date.now() });
          const ctype = parsed.clickType ?? "left";
          const reply = parsed.spokenReply || `Performed ${ctype} click at current cursor position.`;
          setLastReply(reply);
          recordToMemory(rawPrompt, "mouse_click", reply, "executed", {
            target: ctype,
            resolvedReference: refNote,
          });
          await appendAudit("mouse", "mouse_click", "allowed", `type=${ctype}`);
          speakTalkBack(reply);
          return;
        }

        case "mouse_patrol": {
          setIsPatrolling(true);
          const reply = parsed.spokenReply || "Keep-awake autonomous cursor patrol started.";
          setLastReply(reply);
          recordToMemory(rawPrompt, "mouse_patrol", reply, "executed", {
            resolvedReference: refNote,
          });
          await appendAudit("mouse", "mouse_patrol_start", "allowed", "Keep-awake sweep active");
          speakTalkBack(reply);
          return;
        }

        case "mouse_stop": {
          handleEmergencyStop();
          recordToMemory(rawPrompt, "mouse_stop", "Emergency stop engaged.", "executed", {
            resolvedReference: refNote,
          });
          return;
        }

        case "gesture_toggle": {
          const nextEnabled = parsed.enabled ?? !airMouseEnabled;
          setAirMouseEnabled(nextEnabled);
          const reply =
            parsed.spokenReply ||
            (nextEnabled
              ? "MediaPipe Air-Mouse enabled. Use gesture controls or press Escape to stop."
              : "MediaPipe Air-Mouse disabled.");
          setLastReply(reply);
          recordToMemory(rawPrompt, "gesture_toggle", reply, "executed", {
            target: String(nextEnabled),
            resolvedReference: refNote,
          });
          await appendAudit(
            "mouse",
            nextEnabled ? "air_mouse_enabled" : "air_mouse_disabled",
            "allowed",
            "MediaPipe hand tracking toggle"
          );
          speakTalkBack(reply);
          return;
        }

        case "lock_pc": {
          setIsPatrolling(false);
          setAirMouseEnabled(false);
          setIsLocked(true);
          setOrbState("locked");
          const reply =
            parsed.spokenReply ||
            "Workstation locked. Session-0 voice unlock service remains active.";
          setLastReply(reply);
          recordToMemory(rawPrompt, "lock_pc", reply, "executed", {
            resolvedReference: refNote,
          });
          await appendAudit("security", "lock_workstation", "allowed", "LockWorkStation() invoked");
          speakTalkBack(reply);
          return;
        }

        case "unlock_pc": {
          if (!isLocked) {
            const msg = "Your workstation is already unlocked.";
            setLastReply(msg);
            speakTalkBack(msg);
            return;
          }
          if (parsed.passphrase) {
            const res = await handleAttempt2FAUnlock(parsed.passphrase, "owner");
            setLastReply(res.message);
            recordToMemory(
              rawPrompt,
              "unlock_pc",
              res.message,
              res.ok ? "executed" : "blocked",
              { resolvedReference: refNote }
            );
          } else {
            const msg = "Speak or enter your 2FA passphrase in the Lock Screen verification panel.";
            setLastReply(msg);
            speakTalkBack(msg);
          }
          return;
        }

        case "open_vault": {
          setVaultModalOpen(true);
          const reply = parsed.spokenReply || "Opening the Security Vault.";
          setLastReply(reply);
          recordToMemory(rawPrompt, "open_vault", reply, "executed", {
            resolvedReference: refNote,
          });
          await appendAudit("security", "vault_opened", "allowed", "Security Vault dialog opened");
          speakTalkBack(reply);
          return;
        }

        case "web_search": {
          const reply = parsed.spokenReply || "Here is what I found from Google Search.";
          const sourceCount = Array.isArray(parsed.sources) ? parsed.sources.length : 0;
          setLastReply(reply);
          recordToMemory(rawPrompt, "web_search", reply, "answered", {
            target: parsed.searchQuery || rawPrompt,
            resolvedReference: refNote,
          });
          await appendAudit(
            "system",
            "google_search_grounded",
            "allowed",
            `${sourceCount} verified web sources · model=${parsed.modelUsed ?? "gemini-4-hydrogen"}`
          );
          speakTalkBack(reply);
          return;
        }

        case "memory_recall":
        case "general_qa":
        default: {
          const reply = parsed.spokenReply || "Done.";
          setLastReply(reply);
          recordToMemory(rawPrompt, parsed.action, reply, "answered", {
            resolvedReference: refNote,
          });
          if (parsed.action === "memory_recall") {
            await appendAudit("memory", "memory_recall", "allowed", reply);
          }
          speakTalkBack(reply);
        }
      }
    },
    [
      folders,
      apps,
      cursorPos,
      airMouseEnabled,
      isLocked,
      appendAudit,
      recordToMemory,
      speakTalkBack,
      handleEmergencyStop,
      handleAttempt2FAUnlock,
      playTrackInNotch,
      handleStopTrack,
      handleNavigateChrome,
      currentTrack,
      isTrackPlaying,
    ]
  );

  const handleSubmitCommand = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      lastPromptRef.current = clean;
      setActiveTab("desktop");
      setActiveNotchView("ai");
      setNotchExpanded(true);
      setInputValue("");
      setLastError(null);
      setRetryableError(false);
      setLastSources([]);
      setOrbState("thinking");

      try {
        const res = await fetch("/api/notch/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: clean,
            memory: memoryEntries.map((m) => ({
              userInput: m.userInput,
              action: m.action,
              target: m.target,
              root: m.root,
              assistantReply: m.assistantReply,
              outcome: m.outcome,
            })),
            desktopState: {
              assistantName,
              isLocked,
              folders: folders.map((f) => `${f.root}\\${f.name}`),
              openApps: apps.filter((a) => a.isOpen).map((a) => a.name),
              availableApps: apps.map((a) => a.name),
              currentTrack: currentTrack
                ? `${currentTrack.title} by ${currentTrack.artist} (${isTrackPlaying ? "playing" : "paused"})`
                : null,
              isPatrolling,
              airMouseEnabled,
            },
          }),
        });

        const payload = await res.json();
        if (!res.ok) {
          const errMsg =
            typeof payload?.error === "string"
              ? payload.error
              : "Assistant service returned an error.";
          setLastError(errMsg);
          setRetryableError(Boolean(payload?.retryable ?? res.status >= 500));
          setOrbState(isLocked ? "locked" : "idle");
          return;
        }

        await executeNotchIntent(clean, payload as NotchAIResponse);
      } catch (err: unknown) {
        const errMsg =
          err instanceof Error ? err.message : "Network error reaching assistant backend.";
        setLastError(errMsg);
        setRetryableError(true);
        setOrbState(isLocked ? "locked" : "idle");
      }
    },
    [
      assistantName,
      memoryEntries,
      isLocked,
      folders,
      apps,
      currentTrack,
      isTrackPlaying,
      isPatrolling,
      airMouseEnabled,
      executeNotchIntent,
    ]
  );

  const handleToggleLiveVoice = useCallback(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.stop();
      liveSessionRef.current = null;
      setLiveStatus("disconnected");
      setOrbState(isLocked ? "locked" : "idle");
      appendAudit("system", "live_voice_ended", "allowed", "Closed Gemini 3.8 Live session");
      return;
    }

    setActiveTab("desktop");
    setActiveNotchView("ai");
    setNotchExpanded(true);
    setLastError(null);
    setRetryableError(false);
    setLastSources([]);
    liveInputAccRef.current = "";
    liveOutputAccRef.current = "";
    setLiveInputTranscript("");
    setLiveOutputTranscript("");

    const session = new LiveVoiceSession({
      onStatusChange: (status) => {
        setLiveStatus(status);
        if (status === "connecting") setOrbState("thinking");
        else if (status === "live") setOrbState("listening");
        else if (status === "speaking") setOrbState("speaking");
        else {
          liveSessionRef.current = null;
          setOrbState(isLocked ? "locked" : "idle");
        }
      },
      onInputTranscript: (delta) => {
        liveInputAccRef.current = `${liveInputAccRef.current}${delta}`.trimStart();
        setLiveInputTranscript(liveInputAccRef.current);
      },
      onOutputTranscript: (delta) => {
        liveOutputAccRef.current = `${liveOutputAccRef.current}${delta}`.trimStart();
        setLiveOutputTranscript(liveOutputAccRef.current);
      },
      onTurnComplete: () => {
        const spokenUser = liveInputAccRef.current.trim();
        const spokenAi = liveOutputAccRef.current.trim();
        if (spokenUser || spokenAi) {
          setLastReply(spokenAi || "Voice turn completed.");
          recordToMemory(
            spokenUser || "(Live voice audio)",
            "general_qa",
            spokenAi || "(Live voice response)",
            "answered"
          );
          appendAudit("system", "live_voice_turn", "allowed", "Gemini 3.8 Live turn recorded");
        }
        liveInputAccRef.current = "";
        liveOutputAccRef.current = "";
      },
      onError: (msg, retryable) => {
        liveSessionRef.current = null;
        setLastError(msg);
        setRetryableError(retryable);
        setLiveStatus("disconnected");
        setOrbState(isLocked ? "locked" : "idle");
      },
    });

    liveSessionRef.current = session;
    appendAudit("system", "live_voice_started", "allowed", "Connected Gemini 3.8 Live audio session");
    session.start();
  }, [isLocked, appendAudit, recordToMemory]);

  const handleRetryLastCommand = useCallback(() => {
    if (lastPromptRef.current) {
      handleSubmitCommand(lastPromptRef.current);
    }
  }, [handleSubmitCommand]);

  const memorySummary = useMemo(
    () => deriveMemorySummary(memoryEntries, totalMemoryRecorded),
    [memoryEntries, totalMemoryRecorded]
  );

  const navItems: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode; meta?: string }> = [
    {
      id: "desktop",
      label: "Desktop Simulator",
      icon: <Monitor className="h-4 w-4" />,
    },
    {
      id: "memory",
      label: "Memory Buffer",
      icon: <History className="h-4 w-4" />,
      meta: `${memoryEntries.length}/${MEMORY_WINDOW_SIZE}`,
    },
    {
      id: "audit",
      label: "Audit Log",
      icon: <FileText className="h-4 w-4" />,
      meta: String(auditEvents.length),
    },
    {
      id: "source",
      label: "Windows Source",
      icon: <Code2 className="h-4 w-4" />,
      meta: "21",
    },
  ];

  const breadcrumbTitle = (() => {
    switch (activeTab) {
      case "desktop":
        return "Desktop Simulator";
      case "memory":
        return "Short-Term Memory Buffer";
      case "audit":
        return "Audit Log (audit.jsonl)";
      case "source":
        return "Windows 10 & 11 Source Package";
    }
  })();

  return (
    <div className="flex min-h-screen bg-[#0B0E14] text-slate-100">
      {/* Left Workspace Sidebar (248px) */}
      <aside className="hidden w-[248px] shrink-0 flex-col justify-between border-r border-slate-800/90 bg-[#0D1119] p-4 lg:flex">
        <div>
          <div className="px-2 pb-5 pt-1">
            <span className="font-display text-base font-bold tracking-tight text-white">
              WindowsNotch Pro
            </span>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "bg-slate-800/90 text-white"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    <span className={active ? "text-sky-400" : "text-slate-500"}>{item.icon}</span>
                    {item.label}
                  </span>
                  {item.meta && (
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {item.meta}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <hr className="my-5 border-slate-800" />

          {/* Quick Controls */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setVaultModalOpen(true)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <Shield className="h-4 w-4 text-sky-400" />
              <span>Security Vault</span>
            </button>

            <button
              type="button"
              onClick={() => setTtsMuted((m) => !m)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              {ttsMuted ? (
                <VolumeX className="h-4 w-4 text-slate-500" />
              ) : (
                <Volume2 className="h-4 w-4 text-slate-400" />
              )}
              <span>{ttsMuted ? "Talk-Back Muted" : "Talk-Back Voice On"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("desktop");
                setIsLocked((prev) => {
                  const next = !prev;
                  setOrbState(next ? "locked" : "idle");
                  if (next) {
                    appendAudit("security", "lock_workstation", "allowed", "Manual LockWorkStation()");
                  }
                  return next;
                });
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <Lock className="h-4 w-4 text-slate-400" />
              <span>{isLocked ? "Exit Lock Preview" : "Lock Workstation"}</span>
            </button>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => downloadWindowsNotchZip()}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-3 text-xs font-semibold text-slate-950 whitespace-nowrap transition-colors hover:bg-sky-400"
          >
            <Download className="h-3.5 w-3.5" />
            Download Windows .zip
          </button>
          <p className="mt-2.5 text-center text-[11px] text-slate-500">
            Windows 10 &amp; 11 x64 · Modular OS Layer
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean 3-Zone Top Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-8 border-b border-slate-800/90 bg-[#0D1119]/90 px-5">
          <div className="flex items-center gap-2 text-xs whitespace-nowrap shrink-0">
            <span className="font-display font-semibold text-white lg:hidden">
              WindowsNotch Pro
            </span>
            <span className="hidden text-slate-500 lg:inline">WindowsNotch Pro</span>
            <span className="text-slate-600">/</span>
            <span className="font-medium text-slate-200">{breadcrumbTitle}</span>
          </div>

          {/* Mobile / Tablet Navigation Links */}
          <nav className="flex items-center gap-4 text-xs font-medium text-slate-400 lg:hidden">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`whitespace-nowrap transition-colors ${
                  activeTab === item.id ? "text-white" : "hover:text-slate-200"
                }`}
              >
                {item.label.split(" ")[0]}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setVaultModalOpen(true)}
              className="h-8 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-200 whitespace-nowrap transition-colors hover:border-slate-500 hover:text-white"
            >
              Security Vault
            </button>
          </div>
        </header>

        {/* Active Workspace Viewport */}
        <main className="flex-1 overflow-y-auto p-5">
          {activeTab === "desktop" && (
            <DesktopSimulator
              assistantName={assistantName}
              focusedAppId={focusedAppId}
              onFocusApp={(id) => {
                setFocusedAppId(id);
                if (id === "chrome" || id === "edge") {
                  setNotchExpanded(false);
                }
              }}
              notchExpanded={notchExpanded}
              activeNotchView={activeNotchView}
              onChangeNotchView={setActiveNotchView}
              onToggleNotch={(next) =>
                setNotchExpanded((prev) => (typeof next === "boolean" ? next : !prev))
              }
              orbState={orbState}
              liveStatus={liveStatus}
              liveInputTranscript={liveInputTranscript}
              liveOutputTranscript={liveOutputTranscript}
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSubmitCommand={handleSubmitCommand}
              onToggleLiveVoice={handleToggleLiveVoice}
              lastReply={lastReply}
              lastResolvedRef={lastResolvedRef}
              lastSources={lastSources}
              lastError={lastError}
              retryableError={retryableError}
              onRetryLastCommand={handleRetryLastCommand}
              memoryCount={memoryEntries.length}
              currentTrack={currentTrack}
              isTrackPlaying={isTrackPlaying}
              trackProgress={trackProgress}
              songResults={songResults}
              onPlayTrack={(track) => {
                playTrackInNotch(track);
                setLastReply(`Playing ${track.title} by ${track.artist} in NOVA Media.`);
                recordToMemory(`Play ${track.title}`, "song_play", `Playing ${track.title}`, "executed", {
                  target: `${track.title} — ${track.artist}`,
                });
              }}
              onTogglePlayPause={handleTogglePlayPause}
              onStopTrack={handleStopTrack}
              onNextTrack={handleNextTrack}
              onPrevTrack={handlePrevTrack}
              onSearchSongsDirect={handleSearchSongsDirect}
              isLocked={isLocked}
              onLockWorkstation={() => {
                setIsPatrolling(false);
                setAirMouseEnabled(false);
                setIsLocked(true);
                setOrbState("locked");
                setActiveNotchView("bento");
                appendAudit("security", "lock_workstation", "allowed", "LockWorkStation() invoked");
              }}
              onAttempt2FAUnlock={handleAttempt2FAUnlock}
              vault={vault}
              folders={folders}
              recycledFolders={recycledFolders}
              onRestoreRecycled={(id) => {
                const target = recycledFolders.find((r) => r.id === id);
                if (!target) return;
                setRecycledFolders((prev) => prev.filter((r) => r.id !== id));
                setFolders((prev) => [
                  {
                    id: target.id,
                    name: target.name,
                    root: target.originalRoot,
                    createdAt: "Restored",
                    itemCount: 0,
                  },
                  ...prev,
                ]);
                appendAudit(
                  "folder",
                  "folder_restore",
                  "allowed",
                  `Restored ${target.originalRoot}\\${target.name}`
                );
              }}
              apps={apps}
              onOpenAppWindow={handleOpenAppWindow}
              onCloseAppWindow={(appId) => {
                const app = apps.find((a) => a.id === appId);
                setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, isOpen: false } : a)));
                setFocusedAppId((prev) => (prev === appId ? null : prev));
                if (app) {
                  appendAudit("app", "app_close", "allowed", `Closed ${app.processName} via window`);
                }
              }}
              onAttemptProtectedProcess={handleAttemptProtectedProcess}
              onNavigateChrome={handleNavigateChrome}
              cursorPos={cursorPos}
              clickRipple={clickRipple}
              isPatrolling={isPatrolling}
              onToggleKeepAwake={handleToggleKeepAwake}
              airMouseEnabled={airMouseEnabled}
              onToggleAirMouse={handleToggleAirMouse}
              volume={volume}
              onEmergencyStop={handleEmergencyStop}
              onTriggerGesture={handleTriggerGesture}
              onOpenVault={() => setVaultModalOpen(true)}
            />
          )}

          {activeTab === "memory" && (
            <MemoryBufferView
              summary={memorySummary}
              onClearMemory={() => {
                setMemoryEntries([]);
                setLastResolvedRef("");
                appendAudit("memory", "memory_cleared", "info", "Cleared 20-turn sliding window");
              }}
              onRunPrompt={(prompt) => handleSubmitCommand(prompt)}
            />
          )}

          {activeTab === "audit" && <AuditLogView events={auditEvents} />}

          {activeTab === "source" && <SourceCodeView />}
        </main>
      </div>

      {/* In-App Security Vault Dialog */}
      <SecurityVaultModal
        open={vaultModalOpen}
        onClose={() => setVaultModalOpen(false)}
        vault={vault}
        onUpdateVault={(updater, auditMsg) => {
          setVault(updater);
          appendAudit("security", "vault_updated", "allowed", auditMsg, "user");
        }}
      />
    </div>
  );
}
