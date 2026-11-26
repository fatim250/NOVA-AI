import type { SandboxRoot } from "../types/notch";

export const ALLOWED_SANDBOX_ROOTS: readonly SandboxRoot[] = [
  "Desktop",
  "Documents",
  "Downloads",
] as const;

export const PROTECTED_WINDOWS_PROCESSES: readonly string[] = [
  "lsass.exe",
  "csrss.exe",
  "winlogon.exe",
  "svchost.exe",
  "explorer.exe",
  "smss.exe",
  "services.exe",
  "system",
  "ntoskrnl.exe",
] as const;

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const FORBIDDEN_PATH_TOKENS = [
  "..",
  ":",
  "windows",
  "system32",
  "syswow64",
  "program files",
  "programdata",
  "appdata",
  "boot",
  "\\\\",
];

export interface FolderValidationResult {
  allowed: boolean;
  normalizedRoot: SandboxRoot;
  sanitizedName: string;
  reason?: string;
}

export function normalizeSandboxRoot(root?: string): SandboxRoot | null {
  if (!root || root.trim() === "") return "Desktop";
  const lower = root.trim().toLowerCase();
  if (lower.includes("desktop")) return "Desktop";
  if (lower.includes("document")) return "Documents";
  if (lower.includes("download")) return "Downloads";
  return null;
}

export function validateSandboxedFolder(
  rawName: string | undefined,
  rawRoot?: string
): FolderValidationResult {
  const normalizedRoot = normalizeSandboxRoot(rawRoot);
  if (!normalizedRoot) {
    return {
      allowed: false,
      normalizedRoot: "Desktop",
      sanitizedName: rawName ?? "",
      reason: `Root "${rawRoot}" is outside approved sandbox roots (Desktop, Documents, Downloads).`,
    };
  }

  const candidate = (rawName ?? "").trim();
  if (!candidate) {
    return {
      allowed: false,
      normalizedRoot,
      sanitizedName: "",
      reason: "Folder name cannot be empty.",
    };
  }

  const lower = candidate.toLowerCase();
  for (const token of FORBIDDEN_PATH_TOKENS) {
    if (lower.includes(token)) {
      return {
        allowed: false,
        normalizedRoot,
        sanitizedName: candidate,
        reason: `Blocked unsafe path token "${token}" — path traversal and system paths are prohibited.`,
      };
    }
  }

  if (/[<>:"/\\|?*]/.test(candidate)) {
    return {
      allowed: false,
      normalizedRoot,
      sanitizedName: candidate,
      reason: "Folder name contains illegal Windows path characters or nested separators.",
    };
  }

  const upperBase = candidate.split(".")[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(upperBase)) {
    return {
      allowed: false,
      normalizedRoot,
      sanitizedName: candidate,
      reason: `Blocked Windows reserved device name "${upperBase}".`,
    };
  }

  return {
    allowed: true,
    normalizedRoot,
    sanitizedName: candidate,
  };
}

export function isProtectedSystemProcess(appOrProcess: string): boolean {
  const normalized = appOrProcess.trim().toLowerCase();
  return PROTECTED_WINDOWS_PROCESSES.some(
    (proc) => normalized === proc || normalized === proc.replace(/\.exe$/, "")
  );
}
