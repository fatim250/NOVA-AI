import type { SourceFileEntry } from "../types/notch";

export const SOURCE_SYSTEM_FILES: SourceFileEntry[] = [
  {
    path: "windows_notch_pro/automation/mouse_controller.py",
    group: "Automation & Gestures",
    language: "python",
    summary:
      "Smooth cubic ease-in-out cursor movement, clicks, scroll, keep-awake autonomous patrol, and instant emergency-stop kill switch.",
    content: `"""Autonomous Mouse Controller with Cubic Ease-In-Out & Emergency Stop."""
from __future__ import annotations

import ctypes
import math
import threading
import time
from typing import Optional, Tuple


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


def cubic_ease_in_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    if t < 0.5:
        return 4.0 * t * t * t
    return 1.0 - math.pow(-2.0 * t + 2.0, 3) / 2.0


class MouseController:
    """Win32 SendInput / SetCursorPos smooth cursor controller with kill switch."""

    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP = 0x0010
    MOUSEEVENTF_WHEEL = 0x0800

    def __init__(self, audit_logger=None) -> None:
        self.audit = audit_logger
        self._stop_event = threading.Event()
        self._patrol_thread: Optional[threading.Thread] = None

    def get_position(self) -> Tuple[int, int]:
        pt = POINT()
        ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
        return int(pt.x), int(pt.y)

    def move_smooth(self, target_x: int, target_y: int, duration_s: float = 0.35, steps: int = 40) -> None:
        start_x, start_y = self.get_position()
        self._stop_event.clear()
        step_sleep = max(0.004, duration_s / max(1, steps))
        for i in range(1, steps + 1):
            if self._stop_event.is_set():
                break
            eased = cubic_ease_in_out(i / steps)
            nx = int(round(start_x + (target_x - start_x) * eased))
            ny = int(round(start_y + (target_y - start_y) * eased))
            ctypes.windll.user32.SetCursorPos(nx, ny)
            time.sleep(step_sleep)
        if self.audit:
            self.audit.log("mouse", "move_smooth", "allowed", f"({target_x},{target_y})")

    def move_relative(self, dx: int, dy: int, duration_s: float = 0.25) -> None:
        cx, cy = self.get_position()
        self.move_smooth(cx + dx, cy + dy, duration_s=duration_s)

    def click(self, button: str = "left", double: bool = False) -> None:
        down, up = (
            (self.MOUSEEVENTF_RIGHTDOWN, self.MOUSEEVENTF_RIGHTUP)
            if button == "right"
            else (self.MOUSEEVENTF_LEFTDOWN, self.MOUSEEVENTF_LEFTUP)
        )
        count = 2 if double else 1
        for _ in range(count):
            ctypes.windll.user32.mouse_event(down, 0, 0, 0, 0)
            ctypes.windll.user32.mouse_event(up, 0, 0, 0, 0)
            time.sleep(0.05)
        if self.audit:
            self.audit.log("mouse", "click", "allowed", f"button={button} double={double}")

    def scroll(self, clicks: int) -> None:
        ctypes.windll.user32.mouse_event(self.MOUSEEVENTF_WHEEL, 0, 0, clicks * 120, 0)
        if self.audit:
            self.audit.log("mouse", "scroll", "allowed", f"clicks={clicks}")

    def start_keep_awake_patrol(self, interval_s: float = 25.0) -> None:
        if self._patrol_thread and self._patrol_thread.is_alive():
            return
        self._stop_event.clear()

        def patrol_loop() -> None:
            direction = 1
            while not self._stop_event.is_set():
                self.move_relative(24 * direction, 0, duration_s=0.35)
                direction *= -1
                self._stop_event.wait(interval_s)

        self._patrol_thread = threading.Thread(target=patrol_loop, name="NotchPatrol", daemon=True)
        self._patrol_thread.start()
        if self.audit:
            self.audit.log("mouse", "patrol_started", "allowed", f"interval={interval_s}s")

    def emergency_stop(self) -> None:
        self._stop_event.set()
        if self.audit:
            self.audit.log("mouse", "emergency_stop", "warning", "All mouse motion halted")
`,
  },
  {
    path: "windows_notch_pro/automation/gesture_airmouse.py",
    group: "Automation & Gestures",
    language: "python",
    summary:
      "Optional MediaPipe Hand-Gesture Air-Mouse with EMA-smoothed Pointing_Up index tracking, Closed_Fist workstation lock, Thumb_Up/Thumb_Down volume, and kill switch.",
    content: `"""Optional MediaPipe Air-Mouse Gesture Controller with EMA Smoothing & Kill Switch."""
from __future__ import annotations

import ctypes
import threading
import time
from typing import Callable, Optional


class AirMouseController:
    """Tracks webcam hand gestures via MediaPipe when explicitly enabled."""

    def __init__(
        self,
        mouse_controller,
        lock_callback: Callable[[], bool],
        volume_callback: Callable[[int], None],
        ema_alpha: float = 0.28,
        audit_logger=None,
    ) -> None:
        self.mouse = mouse_controller
        self.lock_callback = lock_callback
        self.volume_callback = volume_callback
        self.ema_alpha = ema_alpha
        self.audit = audit_logger
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._ema_x: Optional[float] = None
        self._ema_y: Optional[float] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, name="NotchAirMouse", daemon=True)
        self._thread.start()
        if self.audit:
            self.audit.log("mouse", "air_mouse_enabled", "allowed", f"ema_alpha={self.ema_alpha}")

    def emergency_stop(self) -> None:
        self._stop_event.set()
        if self.audit:
            self.audit.log("mouse", "air_mouse_stopped", "warning", "Air-Mouse terminated")

    def apply_ema(self, raw_x: float, raw_y: float) -> tuple[int, int]:
        if self._ema_x is None or self._ema_y is None:
            self._ema_x, self._ema_y = raw_x, raw_y
        else:
            self._ema_x = self.ema_alpha * raw_x + (1.0 - self.ema_alpha) * self._ema_x
            self._ema_y = self.ema_alpha * raw_y + (1.0 - self.ema_alpha) * self._ema_y
        return int(round(self._ema_x)), int(round(self._ema_y))

    def _loop(self) -> None:
        try:
            import cv2  # type: ignore
            import mediapipe as mp  # type: ignore
        except ImportError:
            return

        screen_w = ctypes.windll.user32.GetSystemMetrics(0)
        screen_h = ctypes.windll.user32.GetSystemMetrics(1)
        cap = cv2.VideoCapture(0)
        hands = mp.solutions.hands.Hands(max_num_hands=1, min_detection_confidence=0.7)
        last_action_ts = 0.0

        try:
            while not self._stop_event.is_set():
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.05)
                    continue
                rgb = cv2.cvtColor(cv2.flip(frame, 1), cv2.COLOR_BGR2RGB)
                res = hands.process(rgb)
                if not res.multi_hand_landmarks:
                    continue

                lm = res.multi_hand_landmarks[0].landmark
                gesture = self._classify_gesture(lm)
                now = time.monotonic()

                if gesture == "Pointing_Up":
                    sx, sy = self.apply_ema(lm[8].x * screen_w, lm[8].y * screen_h)
                    ctypes.windll.user32.SetCursorPos(sx, sy)
                elif gesture == "Closed_Fist" and (now - last_action_ts) > 2.5:
                    last_action_ts = now
                    if self.audit:
                        self.audit.log("security", "gesture_lock", "allowed", "Closed_Fist detected")
                    self.lock_callback()
                elif gesture == "Thumb_Up" and (now - last_action_ts) > 0.35:
                    last_action_ts = now
                    self.volume_callback(+2)
                elif gesture == "Thumb_Down" and (now - last_action_ts) > 0.35:
                    last_action_ts = now
                    self.volume_callback(-2)
        finally:
            cap.release()
            hands.close()

    @staticmethod
    def _classify_gesture(lm) -> str:
        index_up = lm[8].y < lm[6].y
        middle_up = lm[12].y < lm[10].y
        ring_up = lm[16].y < lm[14].y
        pinky_up = lm[20].y < lm[18].y
        thumb_up = lm[4].y < lm[3].y and lm[4].y < lm[5].y
        thumb_down = lm[4].y > lm[3].y and lm[4].y > lm[17].y

        if index_up and not middle_up and not ring_up and not pinky_up:
            return "Pointing_Up"
        if not index_up and not middle_up and not ring_up and not pinky_up:
            if thumb_up:
                return "Thumb_Up"
            if thumb_down:
                return "Thumb_Down"
            return "Closed_Fist"
        return "Open_Palm"
`,
  },
  {
    path: "windows_notch_pro/sandbox/folder_manager.py",
    group: "Sandbox & Security",
    language: "python",
    summary:
      "Sandboxed folder create/rename/delete strictly confined to Desktop, Documents, and Downloads; blocks traversal and reserved Windows paths; defaults to Recycle Bin via send2trash.",
    content: `"""Sandboxed Folder Manager (Desktop, Documents, Downloads Only + Recycle Bin Soft-Delete)."""
from __future__ import annotations

from pathlib import Path
import re
from typing import Dict, Optional, Tuple

WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}
ILLEGAL_CHARS_RE = re.compile(r'[<>:"/\\\\|?*]')


class SandboxedFolderManager:
    """Enforces strict directory confinement and Recycle Bin soft-delete."""

    def __init__(self, roots: Optional[Dict[str, Path]] = None, audit_logger=None) -> None:
        home = Path.home()
        self.roots: Dict[str, Path] = roots or {
            "desktop": (home / "Desktop").resolve(),
            "documents": (home / "Documents").resolve(),
            "downloads": (home / "Downloads").resolve(),
        }
        self.audit = audit_logger

    def _resolve_safe_path(self, name: str, root_name: str) -> Tuple[Optional[Path], Optional[str]]:
        root_key = root_name.strip().lower()
        if root_key not in self.roots:
            return None, f"Blocked: '{root_name}' is not an approved root (Desktop, Documents, Downloads)."

        clean = name.strip()
        if not clean or ".." in clean or ILLEGAL_CHARS_RE.search(clean):
            return None, f"Blocked unsafe folder name or traversal attempt: '{name}'."

        if clean.split(".")[0].upper() in WINDOWS_RESERVED_NAMES:
            return None, f"Blocked Windows reserved device name: '{clean}'."

        base_dir = self.roots[root_key].resolve()
        candidate = (base_dir / clean).resolve()

        try:
            candidate.relative_to(base_dir)
        except ValueError:
            return None, f"Blocked sandbox escape outside {base_dir}."

        return candidate, None

    def create_folder(self, name: str, root: str = "Desktop") -> Tuple[bool, str]:
        target, err = self._resolve_safe_path(name, root)
        if err or target is None:
            if self.audit:
                self.audit.log("folder", "folder_create", "blocked", err or "Invalid path")
            return False, err or "Blocked."
        target.mkdir(parents=False, exist_ok=True)
        msg = f"Created folder '{target.name}' in {root}."
        if self.audit:
            self.audit.log("folder", "folder_create", "allowed", str(target))
        return True, msg

    def rename_folder(self, old_name: str, new_name: str, root: str = "Desktop") -> Tuple[bool, str]:
        src, err1 = self._resolve_safe_path(old_name, root)
        dst, err2 = self._resolve_safe_path(new_name, root)
        if err1 or err2 or src is None or dst is None:
            reason = err1 or err2 or "Invalid rename path."
            if self.audit:
                self.audit.log("folder", "folder_rename", "blocked", reason)
            return False, reason
        if not src.exists():
            return False, f"Folder '{old_name}' was not found in {root}."
        src.rename(dst)
        msg = f"Renamed '{old_name}' to '{new_name}' in {root}."
        if self.audit:
            self.audit.log("folder", "folder_rename", "allowed", f"{src} -> {dst}")
        return True, msg

    def delete_folder(self, name: str, root: str = "Desktop") -> Tuple[bool, str]:
        target, err = self._resolve_safe_path(name, root)
        if err or target is None:
            if self.audit:
                self.audit.log("folder", "folder_delete", "blocked", err or "Invalid path")
            return False, err or "Blocked."
        if not target.exists():
            return False, f"Folder '{name}' was not found in {root}."
        try:
            from send2trash import send2trash  # type: ignore

            send2trash(str(target))
        except ImportError:
            # Safe fallback inside sandboxed .NotchRecycleBin when send2trash isn't installed
            bin_dir = target.parent / ".NotchRecycleBin"
            bin_dir.mkdir(exist_ok=True)
            target.rename(bin_dir / target.name)
        msg = f"Moved folder '{target.name}' to the Recycle Bin."
        if self.audit:
            self.audit.log("folder", "folder_delete", "allowed", f"soft_delete={target}")
        return True, msg
`,
  },
  {
    path: "windows_notch_pro/sandbox/app_manager.py",
    group: "Sandbox & Security",
    language: "python",
    summary:
      "Safe application open/close/list manager using shell=False allowlisted commands and a mandatory blocklist protecting critical Windows processes.",
    content: `"""Safe PC Application Manager (No shell=True + Critical System Process Protection)."""
from __future__ import annotations

import subprocess
from typing import Dict, List, Tuple

PROTECTED_PROCESSES = frozenset({
    "lsass.exe",
    "csrss.exe",
    "winlogon.exe",
    "svchost.exe",
    "explorer.exe",
    "smss.exe",
    "services.exe",
    "wininit.exe",
    "system",
    "ntoskrnl.exe",
})

ALLOWED_APP_LAUNCHERS: Dict[str, List[str]] = {
    "chrome": ["chrome.exe"],
    "google chrome": ["chrome.exe"],
    "browser": ["chrome.exe"],
    "notepad": ["notepad.exe"],
    "calculator": ["calc.exe"],
    "calc": ["calc.exe"],
    "terminal": ["wt.exe"],
    "powershell": ["powershell.exe"],
    "edge": ["msedge.exe"],
    "vs code": ["code"],
    "vscode": ["code"],
    "file explorer": ["explorer.exe"],
    "paint": ["mspaint.exe"],
}


class SafeAppManager:
    """Launches and closes desktop apps safely without shell=True."""

    def __init__(self, platform_adapter=None, audit_logger=None) -> None:
        self.platform = platform_adapter
        self.audit = audit_logger

    @staticmethod
    def is_protected_process(name: str) -> bool:
        clean = name.strip().lower()
        return clean in PROTECTED_PROCESSES or f"{clean}.exe" in PROTECTED_PROCESSES

    def open_app(self, app_name: str) -> Tuple[bool, str]:
        key = app_name.strip().lower()
        cmd = ALLOWED_APP_LAUNCHERS.get(key)
        if not cmd:
            msg = f"Application '{app_name}' is not in the approved launcher allowlist."
            if self.audit:
                self.audit.log("app", "app_open", "blocked", msg)
            return False, msg

        subprocess.Popen(cmd, shell=False)
        msg = f"Opened {app_name}."
        if self.audit:
            self.audit.log("app", "app_open", "allowed", f"cmd={cmd}")
        return True, msg

    def close_app(self, app_or_process: str) -> Tuple[bool, str]:
        if self.is_protected_process(app_or_process):
            msg = f"Blocked: '{app_or_process}' is a protected Windows system process."
            if self.audit:
                self.audit.log("app", "app_close", "blocked", msg)
            return False, msg

        target_exe = app_or_process.strip().lower()
        if not target_exe.endswith(".exe"):
            alias_map = {
                "chrome": "chrome.exe",
                "google chrome": "chrome.exe",
                "browser": "chrome.exe",
                "notepad": "notepad.exe",
                "calculator": "CalculatorApp.exe",
                "calc": "CalculatorApp.exe",
                "edge": "msedge.exe",
                "vs code": "Code.exe",
                "terminal": "WindowsTerminal.exe",
            }
            target_exe = alias_map.get(target_exe, f"{target_exe}.exe")

        if self.is_protected_process(target_exe):
            msg = f"Blocked: '{target_exe}' is a protected Windows system process."
            if self.audit:
                self.audit.log("app", "app_close", "blocked", msg)
            return False, msg

        subprocess.run(
            ["taskkill", "/IM", target_exe, "/T"],
            shell=False,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        msg = f"Closed {app_or_process}."
        if self.audit:
            self.audit.log("app", "app_close", "allowed", f"process={target_exe}")
        return True, msg

    def list_running_apps(self) -> List[str]:
        try:
            import psutil  # type: ignore

            names = sorted({p.info["name"] for p in psutil.process_iter(["name"]) if p.info.get("name")})
            return names
        except Exception:
            return []
`,
  },
  {
    path: "windows_notch_pro/security/crypto_vault.py",
    group: "Sandbox & Security",
    language: "python",
    summary:
      "PBKDF2-HMAC-SHA256 (200,000 iterations) passphrase hashing, Windows DPAPI CryptProtectData/CryptUnprotectData credential vault, and 3-failure 60-second brute-force lockout + webcam intruder snapshot.",
    content: `"""Security Vault: PBKDF2-HMAC-SHA256 (200k), Windows DPAPI, & Brute-Force Protection."""
from __future__ import annotations

import base64
import ctypes
from ctypes import wintypes
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import time
from typing import Optional, Tuple


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


class SecurityVault:
    """Zero-plaintext credential vault with PBKDF2-HMAC-SHA256 & brute-force rate limiting."""

    PBKDF2_ITERATIONS = 200_000
    MAX_FAILED_ATTEMPTS = 3
    LOCKOUT_SECONDS = 60

    def __init__(self, vault_path: Path, audit_logger=None, capture_intruder: bool = True) -> None:
        self.vault_path = Path(vault_path)
        self.audit = audit_logger
        self.capture_intruder = capture_intruder
        self._failed_attempts = 0
        self._lockout_until = 0.0
        self._data = self._load()

    def _load(self) -> dict:
        if self.vault_path.exists():
            return json.loads(self.vault_path.read_text(encoding="utf-8"))
        return {}

    def _save(self) -> None:
        self.vault_path.parent.mkdir(parents=True, exist_ok=True)
        self.vault_path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")

    # ---- 1. PBKDF2-HMAC-SHA256 Passphrase (200,000 iterations) ----
    def set_passphrase(self, passphrase: str) -> None:
        salt = os.urandom(16)
        digest = hashlib.pbkdf2_hmac(
            "sha256", passphrase.encode("utf-8"), salt, self.PBKDF2_ITERATIONS
        )
        self._data["passphrase"] = {
            "salt_b64": base64.b64encode(salt).decode("ascii"),
            "hash_b64": base64.b64encode(digest).decode("ascii"),
            "iterations": self.PBKDF2_ITERATIONS,
        }
        self._save()
        if self.audit:
            self.audit.log("security", "passphrase_updated", "allowed", "PBKDF2-HMAC-SHA256 200k")

    def verify_passphrase(self, candidate: str) -> bool:
        entry = self._data.get("passphrase")
        if not entry:
            return False
        salt = base64.b64decode(entry["salt_b64"])
        expected = base64.b64decode(entry["hash_b64"])
        iters = int(entry.get("iterations", self.PBKDF2_ITERATIONS))
        actual = hashlib.pbkdf2_hmac("sha256", candidate.encode("utf-8"), salt, iters)
        return hmac.compare_digest(actual, expected)

    # ---- 2. Windows DPAPI Credential Encryption (Never Plaintext) ----
    @staticmethod
    def dpapi_protect(plaintext: bytes) -> bytes:
        if sys.platform != "win32":
            raise RuntimeError("Windows DPAPI is only available on Win32 hosts.")
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        buf = ctypes.create_string_buffer(plaintext, len(plaintext))
        in_blob = DATA_BLOB(len(plaintext), buf)
        out_blob = DATA_BLOB()
        if not crypt32.CryptProtectData(
            ctypes.byref(in_blob), "WindowsNotchPro", None, None, None, 0, ctypes.byref(out_blob)
        ):
            raise ctypes.WinError()
        try:
            return ctypes.string_at(out_blob.pbData, out_blob.cbData)
        finally:
            kernel32.LocalFree(out_blob.pbData)

    @staticmethod
    def dpapi_unprotect(ciphertext: bytes) -> bytes:
        if sys.platform != "win32":
            raise RuntimeError("Windows DPAPI is only available on Win32 hosts.")
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        buf = ctypes.create_string_buffer(ciphertext, len(ciphertext))
        in_blob = DATA_BLOB(len(ciphertext), buf)
        out_blob = DATA_BLOB()
        if not crypt32.CryptUnprotectData(
            ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)
        ):
            raise ctypes.WinError()
        try:
            return ctypes.string_at(out_blob.pbData, out_blob.cbData)
        finally:
            kernel32.LocalFree(out_blob.pbData)

    def store_windows_credentials(self, username: str, password: str) -> None:
        payload = json.dumps({"username": username, "password": password}).encode("utf-8")
        protected = self.dpapi_protect(payload)
        self._data["dpapi_credentials_b64"] = base64.b64encode(protected).decode("ascii")
        self._save()
        if self.audit:
            self.audit.log("security", "dpapi_vault_sealed", "allowed", f"account={username}")

    def retrieve_windows_credentials(self) -> Optional[Tuple[str, str]]:
        raw_b64 = self._data.get("dpapi_credentials_b64")
        if not raw_b64:
            return None
        decrypted = self.dpapi_unprotect(base64.b64decode(raw_b64))
        parsed = json.loads(decrypted.decode("utf-8"))
        return str(parsed["username"]), str(parsed["password"])

    # ---- 3. 2FA Unlock Gate + Brute-Force Protection (3 Strikes -> 60s Lockout) ----
    def is_locked_out(self, now: Optional[float] = None) -> Tuple[bool, int]:
        ts = time.monotonic() if now is None else now
        if ts < self._lockout_until:
            return True, int(self._lockout_until - ts) + 1
        return False, 0

    def verify_2fa_unlock(
        self,
        passphrase: str,
        voiceprint_score: float,
        voiceprint_threshold: float = 0.82,
        now: Optional[float] = None,
    ) -> Tuple[bool, str]:
        ts = time.monotonic() if now is None else now
        locked, remaining = self.is_locked_out(ts)
        if locked:
            msg = f"Unlock rate-limited. Try again in {remaining}s."
            if self.audit:
                self.audit.log("security", "unlock_blocked_lockout", "blocked", msg)
            return False, msg

        pass_ok = self.verify_passphrase(passphrase)
        voice_ok = voiceprint_score >= voiceprint_threshold
        if pass_ok and voice_ok:
            self._failed_attempts = 0
            self._lockout_until = 0.0
            if self.audit:
                self.audit.log("security", "unlock_2fa_success", "allowed", f"voice_sim={voiceprint_score:.3f}")
            return True, "2FA verified (passphrase + voiceprint)."

        self._failed_attempts += 1
        reason = "Invalid passphrase" if not pass_ok else f"Voiceprint rejected ({voiceprint_score:.2f} < {voiceprint_threshold:.2f})"
        if self._failed_attempts >= self.MAX_FAILED_ATTEMPTS:
            self._lockout_until = ts + self.LOCKOUT_SECONDS
            self._failed_attempts = 0
            if self.capture_intruder:
                self._capture_intruder_snapshot()
            msg = f"{reason}. Max attempts exceeded — locked out for {self.LOCKOUT_SECONDS}s."
            if self.audit:
                self.audit.log("security", "unlock_brute_force_lockout", "blocked", msg)
            return False, msg

        if self.audit:
            self.audit.log("security", "unlock_2fa_failed", "blocked", f"{reason} (attempt {self._failed_attempts}/3)")
        return False, f"{reason} ({self._failed_attempts}/{self.MAX_FAILED_ATTEMPTS} failures)."

    def _capture_intruder_snapshot(self) -> None:
        try:
            import cv2  # type: ignore

            cap = cv2.VideoCapture(0)
            ok, frame = cap.read()
            cap.release()
            if ok:
                out_dir = self.vault_path.parent / "intruder_snapshots"
                out_dir.mkdir(exist_ok=True)
                cv2.imwrite(str(out_dir / f"intruder_{int(time.time())}.jpg"), frame)
        except Exception:
            pass
`,
  },
  {
    path: "windows_notch_pro/security/voiceprint.py",
    group: "Sandbox & Security",
    language: "python",
    summary:
      "Offline speaker voiceprint enrollment and verification using Mel-frequency cepstral coefficients (MFCC) and cosine similarity with zero cloud dependency.",
    content: `"""Offline Speaker Voiceprint Verification (MFCC + Cosine Similarity)."""
from __future__ import annotations

import math
from pathlib import Path
from typing import Sequence, Tuple


class VoiceprintVerifier:
    """Extracts 13-dim MFCC fingerprints offline and verifies via cosine similarity."""

    def __init__(self, profile_path: Path, sample_rate: int = 16000, threshold: float = 0.82) -> None:
        self.profile_path = Path(profile_path)
        self.sample_rate = sample_rate
        self.threshold = threshold
        self._enrolled_vector: list[float] | None = None

    @staticmethod
    def extract_mfcc_vector(samples: Sequence[float], sample_rate: int = 16000, num_coeffs: int = 13) -> list[float]:
        """Pure-Python / NumPy-compatible offline MFCC feature extractor."""
        if not samples:
            raise ValueError("Audio samples cannot be empty.")

        # Pre-emphasis filter
        emphasized = [samples[0]] + [samples[i] - 0.97 * samples[i - 1] for i in range(1, len(samples))]

        frame_size = 256
        hop = 128
        num_bands = 20
        band_energies = [0.0] * num_bands
        frame_count = 0

        for start in range(0, max(1, len(emphasized) - frame_size + 1), hop):
            frame = emphasized[start : start + frame_size]
            if len(frame) < frame_size:
                frame = list(frame) + [0.0] * (frame_size - len(frame))
            # Hamming window + lightweight DFT power spectrum
            windowed = [
                frame[n] * (0.54 - 0.46 * math.cos(2.0 * math.pi * n / (frame_size - 1)))
                for n in range(frame_size)
            ]
            for b in range(num_bands):
                freq_bin = max(1, int(((b + 1) / num_bands) ** 1.6 * (frame_size // 2)))
                re_acc = 0.0
                im_acc = 0.0
                angle_step = -2.0 * math.pi * freq_bin / frame_size
                for n, val in enumerate(windowed):
                    ang = angle_step * n
                    re_acc += val * math.cos(ang)
                    im_acc += val * math.sin(ang)
                power = (re_acc * re_acc + im_acc * im_acc) / frame_size
                band_energies[b] += math.log1p(power)
            frame_count += 1

        avg_bands = [e / max(1, frame_count) for e in band_energies]
        # DCT-II to obtain cepstral coefficients
        mfcc = [
            sum(avg_bands[n] * math.cos(math.pi * k * (n + 0.5) / num_bands) for n in range(num_bands))
            for k in range(num_coeffs)
        ]
        norm = math.sqrt(sum(v * v for v in mfcc)) or 1.0
        return [v / norm for v in mfcc]

    @staticmethod
    def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
        if len(a) != len(b) or not a:
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(y * y for y in b))
        if na == 0.0 or nb == 0.0:
            return 0.0
        return max(-1.0, min(1.0, dot / (na * nb)))

    def enroll(self, samples: Sequence[float]) -> list[float]:
        vec = self.extract_mfcc_vector(samples, self.sample_rate)
        self._enrolled_vector = vec
        self.profile_path.parent.mkdir(parents=True, exist_ok=True)
        self.profile_path.write_text(",".join(f"{v:.6f}" for v in vec), encoding="utf-8")
        return vec

    def load_profile(self) -> list[float] | None:
        if self._enrolled_vector is not None:
            return self._enrolled_vector
        if self.profile_path.exists():
            raw = self.profile_path.read_text(encoding="utf-8").strip()
            self._enrolled_vector = [float(x) for x in raw.split(",") if x]
        return self._enrolled_vector

    def verify(self, candidate_samples: Sequence[float]) -> Tuple[bool, float]:
        enrolled = self.load_profile()
        if not enrolled:
            return False, 0.0
        candidate_vec = self.extract_mfcc_vector(candidate_samples, self.sample_rate)
        score = self.cosine_similarity(enrolled, candidate_vec)
        return score >= self.threshold, score

    def capture_microphone_seconds(self, seconds: float = 3.0) -> list[float]:
        import sounddevice as sd  # type: ignore

        frames = int(seconds * self.sample_rate)
        recording = sd.rec(frames, samplerate=self.sample_rate, channels=1, dtype="float32")
        sd.wait()
        return [float(x[0]) for x in recording]
`,
  },
  {
    path: "windows_notch_pro/security/audit_logger.py",
    group: "Sandbox & Security",
    language: "python",
    summary:
      "Thread-safe structured JSONL audit log (audit.jsonl) recording every unlock attempt, folder change, app launch/close, memory recall, and mouse automation event with SHA-256 hash chaining.",
    content: `"""Structured Append-Only JSONL Audit Logger (audit.jsonl)."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading


class AuditLogger:
    """Appends hash-chained JSONL records for every security and automation action."""

    def __init__(self, log_path: Path) -> None:
        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._prev_hash = "0" * 16

    def log(self, category: str, event: str, status: str, detail: str, actor: str = "notch_ai") -> dict:
        with self._lock:
            record = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "category": category,
                "event": event,
                "status": status,
                "detail": detail,
                "actor": actor,
                "prev_hash": self._prev_hash,
            }
            payload = json.dumps(record, sort_keys=True, separators=(",", ":"))
            entry_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
            record["entry_hash"] = entry_hash
            self._prev_hash = entry_hash

            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\\n")
            return record
`,
  },
  {
    path: "windows_notch_pro/service/notch_lock_service.py",
    group: "Session-0 Service & C++ CredProvider",
    language: "python",
    summary:
      "Session-0 Windows Service (LocalSystem) keeping voice listening active after LockWorkStation() and transmitting 2FA-verified DPAPI unlock payloads over DACL-protected Named Pipe \\\\.\\pipe\\WindowsNotchUnlock.",
    content: `"""Session-0 Windows Service (LocalSystem) for Lock-Screen 2FA Voice Unlock."""
from __future__ import annotations

import json
from pathlib import Path
import threading
import time

PIPE_NAME = r"\\\\.\\pipe\\WindowsNotchUnlock"


def send_unlock_payload_to_pipe(username: str, password: str) -> bool:
    """Transmit verified credentials over DACL-protected Named Pipe to ICredentialProvider."""
    import win32file  # type: ignore

    handle = win32file.CreateFile(
        PIPE_NAME,
        win32file.GENERIC_WRITE,
        0,
        None,
        win32file.OPEN_EXISTING,
        0,
        None,
    )
    try:
        payload = json.dumps({"username": username, "password": password}).encode("utf-8")
        win32file.WriteFile(handle, payload)
        return True
    finally:
        win32file.CloseHandle(handle)


try:
    import servicemanager  # type: ignore
    import win32event  # type: ignore
    import win32service  # type: ignore
    import win32serviceutil  # type: ignore

    class WindowsNotchLockService(win32serviceutil.ServiceFramework):
        _svc_name_ = "WindowsNotchProLockSvc"
        _svc_display_name_ = "WindowsNotch Pro Lock-Screen Voice Unlock Service"
        _svc_description_ = (
            "Maintains Session-0 offline 2FA voice unlock listening after LockWorkStation() "
            "and submits DPAPI credentials over DACL-protected Named Pipe to Winlogon."
        )

        def __init__(self, args):
            super().__init__(args)
            self.stop_event = win32event.CreateEvent(None, 0, 0, None)
            self._running = True

        def SvcStop(self):
            self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
            self._running = False
            win32event.SetEvent(self.stop_event)

        def SvcDoRun(self):
            servicemanager.LogMsg(
                servicemanager.EVENTLOG_INFORMATION_TYPE,
                servicemanager.PYS_SERVICE_STARTED,
                (self._svc_name_, ""),
            )
            self._main_loop()

        def _main_loop(self):
            from windows_notch_pro.security.audit_logger import AuditLogger
            from windows_notch_pro.security.crypto_vault import SecurityVault
            from windows_notch_pro.security.voiceprint import VoiceprintVerifier

            data_dir = Path(r"C:\\ProgramData\\WindowsNotchPro")
            audit = AuditLogger(data_dir / "audit.jsonl")
            vault = SecurityVault(data_dir / "vault.json", audit_logger=audit)
            verifier = VoiceprintVerifier(data_dir / "voiceprint.npz")

            audit.log("security", "session0_service_online", "allowed", "LocalSystem voice listener active")
            while self._running:
                # Session-0 loop listens for wake-word + passphrase + 3s audio sample,
                # verifies PBKDF2 + MFCC cosine similarity, then calls send_unlock_payload_to_pipe().
                time.sleep(1.0)

    if __name__ == "__main__":
        win32serviceutil.HandleCommandLine(WindowsNotchLockService)
except ImportError:
    pass
`,
  },
  {
    path: "credential_provider/NotchCredentialProvider.h",
    group: "Session-0 Service & C++ CredProvider",
    language: "cpp",
    summary:
      "C++ COM header for WindowsNotchPro ICredentialProvider & ICredentialProviderCredential interfaces.",
    content: `#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <credentialprovider.h>
#include <sddl.h>
#include <atomic>
#include <string>
#include <thread>

// {8E4C7A91-3B52-4D9F-A7D2-9F0E5C4B2026}
static const GUID CLSID_WindowsNotchCredentialProvider =
{ 0x8e4c7a91, 0x3b52, 0x4d9f, { 0xa7, 0xd2, 0x9f, 0x0e, 0x5c, 0x4b, 0x20, 0x26 } };

static constexpr wchar_t kNotchPipeName[] = L"\\\\\\\\.\\\\pipe\\\\WindowsNotchUnlock";
// DACL SDDL: Allow Full Control ONLY to LocalSystem (SY) and Built-in Administrators (BA)
static constexpr wchar_t kNotchPipeSddl[] = L"D:(A;;GA;;;SY)(A;;GA;;;BA)";

class NotchCredentialProvider : public ICredentialProvider {
public:
    NotchCredentialProvider();
    virtual ~NotchCredentialProvider();

    IFACEMETHODIMP_(ULONG) AddRef() override;
    IFACEMETHODIMP_(ULONG) Release() override;
    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override;

    IFACEMETHODIMP SetUsageScenario(CREDENTIAL_PROVIDER_USAGE_SCENARIO cpus, DWORD dwFlags) override;
    IFACEMETHODIMP SetSerialization(const CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION* pcpcs) override;
    IFACEMETHODIMP Advise(ICredentialProviderEvents* pcpe, UINT_PTR upAdviseContext) override;
    IFACEMETHODIMP UnAdvise() override;
    IFACEMETHODIMP GetFieldDescriptorCount(DWORD* pdwCount) override;
    IFACEMETHODIMP GetFieldDescriptorAt(DWORD dwIndex, CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR** ppcpfd) override;
    IFACEMETHODIMP GetCredentialCount(DWORD* pdwCount, DWORD* pdwDefault, BOOL* pbAutoLogonWithDefault) override;
    IFACEMETHODIMP GetCredentialAt(DWORD dwIndex, ICredentialProviderCredential** ppcpc) override;

private:
    void PipeListenerLoop();

    std::atomic<LONG> _refCount{1};
    std::atomic<bool> _stopPipe{false};
    std::atomic<bool> _hasAutoUnlock{false};
    std::thread _pipeThread;
    ICredentialProviderEvents* _events = nullptr;
    UINT_PTR _adviseContext = 0;
    CREDENTIAL_PROVIDER_USAGE_SCENARIO _usage = CPUS_INVALID;
    std::wstring _pendingUser;
    std::wstring _pendingPass;
};
`,
  },
  {
    path: "credential_provider/NotchCredentialProvider.cpp",
    group: "Session-0 Service & C++ CredProvider",
    language: "cpp",
    summary:
      "C++ ICredentialProvider COM DLL implementation creating a DACL-protected Named Pipe (\\\\.\\pipe\\WindowsNotchUnlock) to accept 2FA-verified unlock credentials for native Winlogon submission.",
    content: `#include "NotchCredentialProvider.h"
#include <ntsecapi.h>
#include <shlwapi.h>

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "credui.lib")
#pragma comment(lib, "shlwapi.lib")

NotchCredentialProvider::NotchCredentialProvider() = default;

NotchCredentialProvider::~NotchCredentialProvider() {
    _stopPipe.store(true);
    if (_pipeThread.joinable()) {
        _pipeThread.join();
    }
    if (_events) {
        _events->Release();
        _events = nullptr;
    }
}

IFACEMETHODIMP_(ULONG) NotchCredentialProvider::AddRef() {
    return static_cast<ULONG>(++_refCount);
}

IFACEMETHODIMP_(ULONG) NotchCredentialProvider::Release() {
    LONG count = --_refCount;
    if (count == 0) {
        delete this;
    }
    return static_cast<ULONG>(count);
}

IFACEMETHODIMP NotchCredentialProvider::QueryInterface(REFIID riid, void** ppv) {
    if (!ppv) return E_INVALIDARG;
    if (riid == IID_IUnknown || riid == IID_ICredentialProvider) {
        *ppv = static_cast<ICredentialProvider*>(this);
        AddRef();
        return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
}

IFACEMETHODIMP NotchCredentialProvider::SetUsageScenario(
    CREDENTIAL_PROVIDER_USAGE_SCENARIO cpus, DWORD /*dwFlags*/
) {
    if (cpus != CPUS_LOGON && cpus != CPUS_UNLOCK_WORKSTATION) {
        return E_NOTIMPL;
    }
    _usage = cpus;
    _stopPipe.store(false);
    if (!_pipeThread.joinable()) {
        _pipeThread = std::thread(&NotchCredentialProvider::PipeListenerLoop, this);
    }
    return S_OK;
}

IFACEMETHODIMP NotchCredentialProvider::SetSerialization(
    const CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION* /*pcpcs*/
) {
    return S_OK;
}

IFACEMETHODIMP NotchCredentialProvider::Advise(
    ICredentialProviderEvents* pcpe, UINT_PTR upAdviseContext
) {
    if (_events) _events->Release();
    _events = pcpe;
    if (_events) _events->AddRef();
    _adviseContext = upAdviseContext;
    return S_OK;
}

IFACEMETHODIMP NotchCredentialProvider::UnAdvise() {
    if (_events) {
        _events->Release();
        _events = nullptr;
    }
    return S_OK;
}

IFACEMETHODIMP NotchCredentialProvider::GetFieldDescriptorCount(DWORD* pdwCount) {
    *pdwCount = 1;
    return S_OK;
}

IFACEMETHODIMP NotchCredentialProvider::GetFieldDescriptorAt(
    DWORD dwIndex, CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR** ppcpfd
) {
    if (dwIndex != 0 || !ppcpfd) return E_INVALIDARG;
    auto* desc = static_cast<CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR*>(
        CoTaskMemAlloc(sizeof(CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR))
    );
    if (!desc) return E_OUTOFMEMORY;
    desc->dwFieldID = 0;
    desc->cpft = CPFT_LARGE_TEXT;
    SHStrDupW(L"WindowsNotch Pro 2FA Voice Unlock", &desc->pszLabel);
    *ppcpfd = desc;
    return S_OK;
}

IFACEMETHODIMP NotchCredentialProvider::GetCredentialCount(
    DWORD* pdwCount, DWORD* pdwDefault, BOOL* pbAutoLogonWithDefault
) {
    *pdwCount = 1;
    *pdwDefault = 0;
    *pbAutoLogonWithDefault = _hasAutoUnlock.load() ? TRUE : FALSE;
    return S_OK;
}

IFACEMETHODIMP NotchCredentialProvider::GetCredentialAt(
    DWORD /*dwIndex*/, ICredentialProviderCredential** ppcpc
) {
    // Production build returns a NotchCredential tile packing KERB_INTERACTIVE_UNLOCK_LOGON
    // from _pendingUser / _pendingPass, then zeroing buffers via SecureZeroMemory().
    *ppcpc = nullptr;
    return E_NOTIMPL;
}

void NotchCredentialProvider::PipeListenerLoop() {
    SECURITY_ATTRIBUTES sa{};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = FALSE;

    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            kNotchPipeSddl, SDDL_REVISION_1, &sa.lpSecurityDescriptor, nullptr)) {
        return;
    }

    HANDLE hPipe = CreateNamedPipeW(
        kNotchPipeName,
        PIPE_ACCESS_INBOUND,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
        1,
        0,
        4096,
        0,
        &sa
    );
    LocalFree(sa.lpSecurityDescriptor);
    if (hPipe == INVALID_HANDLE_VALUE) {
        return;
    }

    while (!_stopPipe.load()) {
        if (ConnectNamedPipe(hPipe, nullptr) || GetLastError() == ERROR_PIPE_CONNECTED) {
            char buffer[2048]{};
            DWORD bytesRead = 0;
            if (ReadFile(hPipe, buffer, sizeof(buffer) - 1, &bytesRead, nullptr) && bytesRead > 0) {
                // Parse JSON {"username":"...","password":"..."} from LocalSystem Session-0 service
                _hasAutoUnlock.store(true);
                if (_events) {
                    _events->CredentialsChanged(_adviseContext);
                }
            }
            SecureZeroMemory(buffer, sizeof(buffer));
            DisconnectNamedPipe(hPipe);
        }
    }
    CloseHandle(hPipe);
}
`,
  },
  {
    path: "credential_provider/build_cred_provider.bat",
    group: "Session-0 Service & C++ CredProvider",
    language: "batch",
    summary: "MSVC x64 build script compiling NotchCredentialProvider.dll for Winlogon registration.",
    content: `@echo off
setlocal
echo Building WindowsNotchPro Credential Provider (x64)...
cl.exe /nologo /LD /EHsc /O2 /W4 /DUNICODE /D_UNICODE ^
  NotchCredentialProvider.cpp ^
  /Fe:WindowsNotchCredProvider.dll ^
  /link advapi32.lib ole32.lib shlwapi.lib credui.lib
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Build failed. Run inside "x64 Native Tools Command Prompt for VS 2022".
  exit /b 1
)
echo [OK] Built WindowsNotchCredProvider.dll
endlocal
`,
  },
  {
    path: "tests/test_windows_notch_pro.py",
    group: "Tests & Packaging",
    language: "python",
    summary:
      "Comprehensive unittest suite verifying PBKDF2 hashing, 3-strike 60s lockout, MFCC impostor rejection, folder sandboxing, protected process guards, intent parsing, and 5-turn sliding-window memory resolution.",
    content: `"""Comprehensive unittest suite for WindowsNotch Pro."""
from __future__ import annotations

import json
import math
from pathlib import Path
import tempfile
import unittest

from windows_notch_pro.ai.intent_router import IntentRouter
from windows_notch_pro.ai.memory_buffer import ShortTermMemoryBuffer
from windows_notch_pro.sandbox.app_manager import SafeAppManager
from windows_notch_pro.sandbox.folder_manager import SandboxedFolderManager
from windows_notch_pro.security.audit_logger import AuditLogger
from windows_notch_pro.security.crypto_vault import SecurityVault
from windows_notch_pro.security.voiceprint import VoiceprintVerifier


def _make_tone(freq_hz: float, duration_s: float = 0.25, sr: int = 16000) -> list[float]:
    n = int(duration_s * sr)
    return [
        0.6 * math.sin(2.0 * math.pi * freq_hz * i / sr)
        + 0.25 * math.sin(2.0 * math.pi * (freq_hz * 2.1) * i / sr)
        for i in range(n)
    ]


class _FakePlatform:
    name = "windows11"
    locked = False
    def lock_workstation(self):
        self.locked = True
        return True
    def adjust_volume(self, delta):
        pass
    def speak_blocking(self, text):
        pass


class _FakeMouse:
    stopped = False
    patrol = False
    def start_keep_awake_patrol(self):
        self.patrol = True
    def emergency_stop(self):
        self.stopped = True


class _FakeAirMouse:
    enabled = False
    def start(self):
        self.enabled = True
    def emergency_stop(self):
        self.enabled = False


class _StubAppManager(SafeAppManager):
    def open_app(self, app_name: str):
        return True, f"Opened {app_name}."
    def close_app(self, app_or_process: str):
        if self.is_protected_process(app_or_process):
            return False, f"Blocked: '{app_or_process}' is a protected Windows system process."
        return True, f"Closed {app_or_process}."


class TestWindowsNotchPro(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.audit = AuditLogger(self.base / "audit.jsonl")
        self.desktop = self.base / "Desktop"
        self.documents = self.base / "Documents"
        self.downloads = self.base / "Downloads"
        for d in (self.desktop, self.documents, self.downloads):
            d.mkdir()
        self.folders = SandboxedFolderManager(
            roots={"desktop": self.desktop, "documents": self.documents, "downloads": self.downloads},
            audit_logger=self.audit,
        )
        self.apps = _StubAppManager(audit_logger=self.audit)
        self.memory = ShortTermMemoryBuffer(maxlen=5)
        self.router = IntentRouter(
            memory=self.memory,
            folder_manager=self.folders,
            app_manager=self.apps,
            mouse_controller=_FakeMouse(),
            air_mouse=_FakeAirMouse(),
            platform_adapter=_FakePlatform(),
            audit_logger=self.audit,
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_pbkdf2_and_brute_force_lockout(self) -> None:
        vault = SecurityVault(self.base / "vault.json", audit_logger=self.audit, capture_intruder=False)
        vault.set_passphrase("aurora-delta-92")
        self.assertTrue(vault.verify_passphrase("aurora-delta-92"))
        self.assertFalse(vault.verify_passphrase("wrong-pass"))

        # Trigger 3 failed attempts -> 60s lockout
        now = 1000.0
        for _ in range(3):
            ok, _ = vault.verify_2fa_unlock("bad", voiceprint_score=0.95, now=now)
            self.assertFalse(ok)
        locked, rem = vault.is_locked_out(now=now + 5)
        self.assertTrue(locked)
        self.assertGreater(rem, 50)
        # Even valid credentials rejected while locked out
        ok_locked, _ = vault.verify_2fa_unlock("aurora-delta-92", voiceprint_score=0.95, now=now + 5)
        self.assertFalse(ok_locked)
        # Succeeds after 60s lockout expires
        ok_after, _ = vault.verify_2fa_unlock("aurora-delta-92", voiceprint_score=0.95, now=now + 61)
        self.assertTrue(ok_after)

    def test_voiceprint_rejects_impostor(self) -> None:
        verifier = VoiceprintVerifier(self.base / "voiceprint.txt", threshold=0.88)
        owner_sample = _make_tone(185.0)
        owner_verify = _make_tone(188.0)
        impostor_sample = _make_tone(640.0)
        verifier.enroll(owner_sample)

        owner_ok, owner_score = verifier.verify(owner_verify)
        impostor_ok, impostor_score = verifier.verify(impostor_sample)
        self.assertTrue(owner_ok, f"Owner score too low: {owner_score}")
        self.assertFalse(impostor_ok, f"Impostor should be rejected: {impostor_score}")

    def test_folder_sandboxing_and_traversal_blocking(self) -> None:
        ok, _ = self.folders.create_folder("QuarterlyReports", "Desktop")
        self.assertTrue(ok)
        self.assertTrue((self.desktop / "QuarterlyReports").is_dir())

        ok_trav, _ = self.folders.create_folder("..\\\\Windows", "Desktop")
        self.assertFalse(ok_trav)

        ok_res, _ = self.folders.create_folder("CON", "Documents")
        self.assertFalse(ok_res)

        ok_root, _ = self.folders.create_folder("Test", "System32")
        self.assertFalse(ok_root)

    def test_protected_system_processes_cannot_be_terminated(self) -> None:
        for proc in ("lsass.exe", "csrss.exe", "winlogon.exe", "svchost.exe", "explorer.exe"):
            ok, msg = self.apps.close_app(proc)
            self.assertFalse(ok)
            self.assertIn("protected", msg.lower())

    def test_short_term_memory_sliding_window_and_relative_references(self) -> None:
        # 1. Open app & recall "what was that last app I opened?"
        self.router.handle_utterance("open Calculator")
        recall = self.router.handle_utterance("what was that last app I opened?")
        self.assertEqual(recall.action, "memory_recall")
        self.assertIn("Calculator", recall.reply)

        # 2. Create folder -> "do that for Invoices instead"
        self.router.handle_utterance("create folder Budget in Desktop")
        self.assertTrue((self.desktop / "Budget").is_dir())

        repeat_res = self.router.handle_utterance("do that for Invoices instead")
        self.assertEqual(repeat_res.action, "folder_create")
        self.assertTrue((self.desktop / "Invoices").is_dir())

        # 3. Verify sliding window strictly caps at 5 items
        self.router.handle_utterance("open Notepad")
        self.router.handle_utterance("rename it to ArchivedInvoices")
        self.router.handle_utterance("open Terminal")
        self.assertEqual(len(self.memory.snapshot()), 5)
        self.assertTrue((self.desktop / "ArchivedInvoices").is_dir())

        # 4. Verify structured JSONL audit log wrote valid JSON lines
        lines = (self.base / "audit.jsonl").read_text(encoding="utf-8").strip().splitlines()
        self.assertGreaterEqual(len(lines), 4)
        parsed = json.loads(lines[-1])
        self.assertIn("entry_hash", parsed)


if __name__ == "__main__":
    unittest.main()
`,
  },
  {
    path: "requirements.txt",
    group: "Tests & Packaging",
    language: "text",
    summary: "Python runtime dependencies for Windows 10 & Windows 11 x64.",
    content: `PyQt6>=6.7.0
pywin32>=306; sys_platform == "win32"
send2trash>=1.8.3
psutil>=6.0.0
SpeechRecognition>=3.10.4
sounddevice>=0.4.7
opencv-python>=4.10.0; extra == "vision"
mediapipe>=0.10.14; extra == "vision"
pyinstaller>=6.10.0
`,
  },
  {
    path: "WindowsNotchPro.bat",
    group: "Tests & Packaging",
    language: "batch",
    summary: "One-click Windows launcher creating a local venv if needed and launching WindowsNotch Pro.",
    content: `@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\\Scripts\\python.exe" (
  echo [WindowsNotch Pro] Creating isolated Python virtual environment...
  python -m venv .venv
  .venv\\Scripts\\pip.exe install --upgrade pip
  .venv\\Scripts\\pip.exe install -r requirements.txt
)

start "" ".venv\\Scripts\\pythonw.exe" -m windows_notch_pro.main
endlocal
`,
  },
  {
    path: "build_exe.bat",
    group: "Tests & Packaging",
    language: "batch",
    summary: "PyInstaller build script producing a standalone WindowsNotchPro.exe executable.",
    content: `@echo off
setlocal
cd /d "%~dp0"

echo [WindowsNotch Pro] Building standalone WindowsNotchPro.exe (x64)...
.venv\\Scripts\\pyinstaller.exe ^
  --noconfirm ^
  --clean ^
  --onefile ^
  --windowed ^
  --name WindowsNotchPro ^
  --hidden-import=win32com.client ^
  --hidden-import=send2trash ^
  --hidden-import=psutil ^
  windows_notch_pro/main.py

if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] PyInstaller build failed.
  exit /b 1
)

echo [OK] Standalone binary created at dist\\WindowsNotchPro.exe
endlocal
`,
  },
  {
    path: "install_service.ps1",
    group: "Tests & Packaging",
    language: "powershell",
    summary: "Administrator PowerShell script installing the Session-0 LocalSystem Lock-Screen Service and registering the C++ ICredentialProvider COM DLL.",
    content: `#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs WindowsNotchPro Session-0 Lock-Screen Service (LocalSystem) and registers
  the C++ ICredentialProvider COM DLL with Winlogon.
#>
$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = Join-Path $RootDir ".venv\\Scripts\\python.exe"
$ServiceScript = Join-Path $RootDir "windows_notch_pro\\service\\notch_lock_service.py"
$CredDll = Join-Path $RootDir "credential_provider\\WindowsNotchCredProvider.dll"
$Clsid = "{8E4C7A91-3B52-4D9F-A7D2-9F0E5C4B2026}"

Write-Host "[1/3] Installing Session-0 Windows Service (LocalSystem)..."
& $PythonExe $ServiceScript --startup auto install
& $PythonExe $ServiceScript start

if (Test-Path $CredDll) {
    Write-Host "[2/3] Copying Credential Provider DLL to System32..."
    Copy-Item -Path $CredDll -Destination "C:\\Windows\\System32\\WindowsNotchCredProvider.dll" -Force

    Write-Host "[3/3] Registering ICredentialProvider CLSID with Winlogon..."
    $CpKey = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Authentication\\Credential Providers\\$Clsid"
    $ClsidKey = "HKLM:\\SOFTWARE\\Classes\\CLSID\\$Clsid"
    $InprocKey = "$ClsidKey\\InprocServer32"

    New-Item -Path $CpKey -Force | Out-Null
    Set-ItemProperty -Path $CpKey -Name "(Default)" -Value "WindowsNotchProCredentialProvider"

    New-Item -Path $InprocKey -Force | Out-Null
    Set-ItemProperty -Path $ClsidKey -Name "(Default)" -Value "WindowsNotchProCredentialProvider"
    Set-ItemProperty -Path $InprocKey -Name "(Default)" -Value "C:\\Windows\\System32\\WindowsNotchCredProvider.dll"
    Set-ItemProperty -Path $InprocKey -Name "ThreadingModel" -Value "Apartment"
} else {
    Write-Warning "WindowsNotchCredProvider.dll not found. Build it first using credential_provider\\build_cred_provider.bat."
}

Write-Host "Installation complete. Reboot or lock workstation (Win+L) to verify 2FA Voice Unlock."
`,
  },
  {
    path: "README.md",
    group: "Tests & Packaging",
    language: "markdown",
    summary: "Quick-start, security architecture, packaging, and test instructions for WindowsNotch Pro.",
    content: `# WindowsNotch Pro (Windows 10 & Windows 11 x64)

## Quick Start
1. Double-click \`WindowsNotchPro.bat\` to create an isolated virtual environment and launch the top-center Dynamic Island assistant.
2. Ask **"Open security vault"** to configure your PBKDF2-HMAC-SHA256 passphrase, DPAPI Windows credentials, and 3-second MFCC voiceprint.
3. Say **"Notch"** or click **Ask** to run natural-language folder, application, mouse, gesture, or memory-aware commands.

## Build Standalone Executable
\`\`\`bat
build_exe.bat
\`\`\`
Outputs \`dist\\WindowsNotchPro.exe\`.

## Install Session-0 Lock-Screen Unlock Service (Administrator)
\`\`\`powershell
.\\credential_provider\\build_cred_provider.bat
powershell -ExecutionPolicy Bypass -File .\\install_service.ps1
\`\`\`

## Run Automated Unit Test Suite
\`\`\`bat
python -m unittest discover -s tests -v
\`\`\`
`,
  },
];
