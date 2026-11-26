export type SandboxRoot = "Desktop" | "Documents" | "Downloads";

export type NotchActionType =
  | "set_assistant_name"
  | "folder_create"
  | "folder_rename"
  | "folder_delete"
  | "app_open"
  | "app_close"
  | "app_list"
  | "song_search"
  | "song_play"
  | "song_pause"
  | "song_resume"
  | "song_stop"
  | "mouse_move"
  | "mouse_click"
  | "mouse_patrol"
  | "mouse_stop"
  | "gesture_toggle"
  | "lock_pc"
  | "unlock_pc"
  | "open_vault"
  | "memory_recall"
  | "web_search"
  | "general_qa";

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface SongTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  previewUrl: string;
  artworkUrl: string;
}

export interface NotchAIResponse {
  action: NotchActionType;
  target?: string;
  newName?: string;
  root?: string;
  url?: string;
  direction?: "center" | "left" | "right" | "up" | "down";
  x?: number;
  y?: number;
  clickType?: "left" | "right" | "double" | "scroll_up" | "scroll_down";
  enabled?: boolean;
  passphrase?: string;
  searchQuery?: string;
  needsSearch?: boolean;
  resolvedReference: string;
  spokenReply: string;
  sources?: GroundingSource[];
  songs?: SongTrack[];
  grounded?: boolean;
  modelUsed?: string;
}

export interface MemoryInteraction {
  id: string;
  turnNumber: number;
  timestamp: string;
  userInput: string;
  action: NotchActionType;
  target?: string;
  newName?: string;
  root?: SandboxRoot;
  resolvedReference?: string;
  assistantReply: string;
  outcome: "executed" | "blocked" | "answered" | "error";
}

export interface VirtualFolder {
  id: string;
  name: string;
  root: SandboxRoot;
  createdAt: string;
  itemCount: number;
}

export interface RecycledFolder {
  id: string;
  name: string;
  originalRoot: SandboxRoot;
  deletedAt: string;
}

export interface DesktopApp {
  id: string;
  name: string;
  processName: string;
  isOpen: boolean;
  protectedSystem?: boolean;
  windowTitle: string;
  previewLines: string[];
  browserUrl?: string;
  x: number;
  y: number;
  zIndex: number;
}

export type AuditCategory = "security" | "folder" | "app" | "mouse" | "memory" | "system";

export interface AuditEvent {
  id: string;
  timestamp: string;
  category: AuditCategory;
  event: string;
  status: "allowed" | "blocked" | "warning" | "info";
  detail: string;
  actor: string;
  prevHash: string;
  entryHash: string;
}

export interface VaultState {
  passphraseConfigured: boolean;
  passphraseSaltHex: string;
  passphraseHashHex: string;
  pbkdf2Iterations: number;
  windowsAccount: string;
  dpapiBlobPreview: string;
  voiceprintEnrolled: boolean;
  voiceprintVector: number[];
  voiceprintThreshold: number;
  voiceprintEnrolledAt: string | null;
  failedAttempts: number;
  lockoutUntil: number | null;
  captureIntruderSnapshot: boolean;
  lastIntruderSnapshotAt: string | null;
}

export interface SourceFileEntry {
  path: string;
  group:
    | "Entry & Platform"
    | "UI & Security Vault"
    | "AI & Short-Term Memory"
    | "Voice & Talk-Back"
    | "Automation & Gestures"
    | "Sandbox & Security"
    | "Session-0 Service & C++ CredProvider"
    | "Tests & Packaging";
  language: "python" | "cpp" | "powershell" | "batch" | "text" | "markdown";
  summary: string;
  content: string;
}
