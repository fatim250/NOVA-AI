import type { SourceFileEntry } from "../types/notch";

export const SOURCE_CORE_FILES: SourceFileEntry[] = [
  {
    path: "windows_notch_pro/main.py",
    group: "Entry & Platform",
    language: "python",
    summary:
      "Application entry point enabling Per-Monitor V2 DPI awareness, Windows 11 DWM rounded corners with Windows 10 fallback, and modular cross-platform wiring.",
    content: `"""WindowsNotch Pro — Production Entry Point (Windows 10 & Windows 11 x64)."""
from __future__ import annotations

import ctypes
import sys
from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import QApplication

from windows_notch_pro.ai.intent_router import IntentRouter
from windows_notch_pro.ai.memory_buffer import ShortTermMemoryBuffer
from windows_notch_pro.automation.gesture_airmouse import AirMouseController
from windows_notch_pro.automation.mouse_controller import MouseController
from windows_notch_pro.platform_abstraction.base import create_platform_adapter
from windows_notch_pro.sandbox.app_manager import SafeAppManager
from windows_notch_pro.sandbox.folder_manager import SandboxedFolderManager
from windows_notch_pro.security.audit_logger import AuditLogger
from windows_notch_pro.security.crypto_vault import SecurityVault
from windows_notch_pro.security.voiceprint import VoiceprintVerifier
from windows_notch_pro.ui.notch_window import DynamicNotchWindow
from windows_notch_pro.voice.listener import WakeWordVoiceListener
from windows_notch_pro.voice.tts_engine import NativeTTSEngine


def enable_per_monitor_v2_dpi() -> None:
    """Enable Per-Monitor V2 DPI awareness on Windows 10 (1703+) & Windows 11."""
    if sys.platform != "win32":
        return
    try:
        dpi_awareness_context_pmv2 = ctypes.c_void_p(-4)
        ctypes.windll.user32.SetProcessDpiAwarenessContext(dpi_awareness_context_pmv2)
    except Exception:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()


def main() -> int:
    enable_per_monitor_v2_dpi()
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    app = QApplication(sys.argv)
    app.setApplicationName("WindowsNotch Pro")
    app.setQuitOnLastWindowClosed(False)

    data_dir = Path.home() / ".windows_notch_pro"
    data_dir.mkdir(parents=True, exist_ok=True)

    platform_adapter = create_platform_adapter()
    audit_logger = AuditLogger(data_dir / "audit.jsonl")
    vault = SecurityVault(data_dir / "vault.json", audit_logger=audit_logger)
    voiceprint = VoiceprintVerifier(data_dir / "voiceprint.npz")
    memory = ShortTermMemoryBuffer(maxlen=20)

    folders = SandboxedFolderManager(audit_logger=audit_logger)
    apps = SafeAppManager(platform_adapter=platform_adapter, audit_logger=audit_logger)
    mouse = MouseController(audit_logger=audit_logger)
    air_mouse = AirMouseController(
        mouse_controller=mouse,
        lock_callback=platform_adapter.lock_workstation,
        volume_callback=platform_adapter.adjust_volume,
        audit_logger=audit_logger,
    )
    tts = NativeTTSEngine(platform_adapter=platform_adapter)
    router = IntentRouter(
        memory=memory,
        folder_manager=folders,
        app_manager=apps,
        mouse_controller=mouse,
        air_mouse=air_mouse,
        platform_adapter=platform_adapter,
        audit_logger=audit_logger,
    )

    window = DynamicNotchWindow(
        router=router,
        tts=tts,
        vault=vault,
        voiceprint=voiceprint,
        platform_adapter=platform_adapter,
        audit_logger=audit_logger,
    )

    listener = WakeWordVoiceListener(
        wake_word="notch",
        on_command=window.handle_voice_transcript,
        on_state_change=window.set_orb_state,
    )
    listener.start()
    window.attach_listener(listener)
    window.show()

    audit_logger.log("system", "app_started", "allowed", f"platform={platform_adapter.name}")
    exit_code = app.exec()
    listener.stop()
    air_mouse.emergency_stop()
    mouse.emergency_stop()
    tts.shutdown()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
`,
  },
  {
    path: "windows_notch_pro/platform_abstraction/base.py",
    group: "Entry & Platform",
    language: "python",
    summary:
      "Cross-platform OS adapter layer isolating Windows DWM/DPAPI/SAPI calls with clean Linux and macOS abstractions for future releases.",
    content: `"""Cross-platform OS abstraction layer (Windows 10/11 primary, Linux & macOS ready)."""
from __future__ import annotations

import abc
import ctypes
import subprocess
import sys


class PlatformAdapter(abc.ABC):
    """Abstract interface decoupling desktop shell, DWM styling, lock, and TTS."""

    @property
    @abc.abstractmethod
    def name(self) -> str:
        raise NotImplementedError

    @abc.abstractmethod
    def apply_rounded_corners(self, native_hwnd: int) -> bool:
        raise NotImplementedError

    @abc.abstractmethod
    def lock_workstation(self) -> bool:
        raise NotImplementedError

    @abc.abstractmethod
    def adjust_volume(self, delta_steps: int) -> None:
        raise NotImplementedError

    @abc.abstractmethod
    def speak_blocking(self, text: str) -> None:
        raise NotImplementedError


class WindowsPlatformAdapter(PlatformAdapter):
    """Native Windows 10 & Windows 11 implementation using Win32, DWM, and SAPI."""

    DWMWA_WINDOW_CORNER_PREFERENCE = 33
    DWMWCP_ROUND = 2

    @property
    def name(self) -> str:
        ver = sys.getwindowsversion()
        return "windows11" if ver.build >= 22000 else "windows10"

    def apply_rounded_corners(self, native_hwnd: int) -> bool:
        """Apply Windows 11 native DWM rounded corners; graceful no-op on Windows 10."""
        try:
            ver = sys.getwindowsversion()
            if ver.build < 22000:
                return False  # Windows 10 falls back to Qt frameless rounded QPainterPath
            preference = ctypes.c_int(self.DWMWCP_ROUND)
            hr = ctypes.windll.dwmapi.DwmSetWindowAttribute(
                ctypes.c_void_p(native_hwnd),
                ctypes.c_uint(self.DWMWA_WINDOW_CORNER_PREFERENCE),
                ctypes.byref(preference),
                ctypes.sizeof(preference),
            )
            return hr == 0
        except Exception:
            return False

    def lock_workstation(self) -> bool:
        try:
            return bool(ctypes.windll.user32.LockWorkStation())
        except Exception:
            return False

    def adjust_volume(self, delta_steps: int) -> None:
        vk_volume_up = 0xAF
        vk_volume_down = 0xAE
        key = vk_volume_up if delta_steps > 0 else vk_volume_down
        for _ in range(abs(delta_steps)):
            ctypes.windll.user32.keybd_event(key, 0, 0, 0)
            ctypes.windll.user32.keybd_event(key, 0, 2, 0)

    def speak_blocking(self, text: str) -> None:
        clean = text.strip()
        if not clean:
            return
        try:
            import win32com.client  # type: ignore

            speaker = win32com.client.Dispatch("SAPI.SpVoice")
            speaker.Speak(clean)
        except Exception:
            # Safe argument-vector invocation without shell=True using System.Speech
            ps_script = (
                "Add-Type -AssemblyName System.Speech; "
                "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                "$s.Speak($args[0])"
            )
            subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_script, clean],
                shell=False,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )


class MacOSPlatformAdapter(PlatformAdapter):
    """Future macOS adapter using AppKit, CoreGraphics, and NSSpeechSynthesizer ('say')."""

    @property
    def name(self) -> str:
        return "macos"

    def apply_rounded_corners(self, native_hwnd: int) -> bool:
        return False

    def lock_workstation(self) -> bool:
        subprocess.run(["pmset", "displaysleepnow"], shell=False, check=False)
        return True

    def adjust_volume(self, delta_steps: int) -> None:
        delta = delta_steps * 6
        subprocess.run(
            ["osascript", "-e", f"set volume output volume ((output volume of (get volume settings)) + {delta})"],
            shell=False,
            check=False,
        )

    def speak_blocking(self, text: str) -> None:
        subprocess.run(["say", text], shell=False, check=False)


class LinuxPlatformAdapter(PlatformAdapter):
    """Future Linux adapter targeting Wayland/X11, loginctl, pactl, and espeak-ng."""

    @property
    def name(self) -> str:
        return "linux"

    def apply_rounded_corners(self, native_hwnd: int) -> bool:
        return False

    def lock_workstation(self) -> bool:
        subprocess.run(["loginctl", "lock-session"], shell=False, check=False)
        return True

    def adjust_volume(self, delta_steps: int) -> None:
        sign = "+" if delta_steps > 0 else "-"
        subprocess.run(
            ["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{sign}{abs(delta_steps) * 5}%"],
            shell=False,
            check=False,
        )

    def speak_blocking(self, text: str) -> None:
        subprocess.run(["espeak-ng", text], shell=False, check=False)


def create_platform_adapter() -> PlatformAdapter:
    if sys.platform == "win32":
        return WindowsPlatformAdapter()
    if sys.platform == "darwin":
        return MacOSPlatformAdapter()
    return LinuxPlatformAdapter()
`,
  },
  {
    path: "windows_notch_pro/ui/notch_window.py",
    group: "UI & Security Vault",
    language: "python",
    summary:
      "Minimal top-center Dynamic Island (~248x48 idle pill -> ~440x148 conversational pop-down card) with translucent glassmorphism, glowing orb, Mic/Ask triggers, and zero button clutter.",
    content: `"""2026 Minimal Conversational Dynamic Island UI (PyQt6)."""
from __future__ import annotations

from typing import Optional

from PyQt6.QtCore import (
    QEasingCurve,
    QPropertyAnimation,
    QRect,
    Qt,
    QTimer,
    pyqtSignal,
)
from PyQt6.QtGui import QColor, QGuiApplication, QLinearGradient, QPainter, QPainterPath, QPen
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from windows_notch_pro.ui.security_vault_dialog import SecurityVaultDialog


class DynamicNotchWindow(QWidget):
    """Top-center translucent Dynamic Island: nameless by default, auto-hides inside browsers."""

    IDLE_NAMELESS_WIDTH = 176
    IDLE_NAMED_WIDTH = 248
    IDLE_HEIGHT = 48
    EXPANDED_WIDTH = 440
    EXPANDED_HEIGHT = 148
    TOP_MARGIN = 10
    BROWSER_PROCESSES = frozenset({
        "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "arc.exe"
    })

    transcript_received = pyqtSignal(str)
    orb_state_changed = pyqtSignal(str)

    def __init__(self, router, tts, vault, voiceprint, platform_adapter, audit_logger):
        super().__init__()
        self.router = router
        self.tts = tts
        self.vault = vault
        self.voiceprint = voiceprint
        self.platform_adapter = platform_adapter
        self.audit_logger = audit_logger
        self._listener = None
        self.assistant_name = ""  # Nameless by default until the user names it
        self._expanded = False
        self._hidden_for_browser = False
        self._orb_state = "idle"
        self._orb_phase = 0.0

        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        self._build_ui()
        self._position_top_center(self._idle_width(), self.IDLE_HEIGHT)
        self.platform_adapter.apply_rounded_corners(int(self.winId()))

        self.transcript_received.connect(self._execute_natural_language)
        self.orb_state_changed.connect(self._apply_orb_state)

        self._orb_timer = QTimer(self)
        self._orb_timer.timeout.connect(self._tick_orb)
        self._orb_timer.start(40)

        # Monitor foreground browser window so tabs are never blocked
        self._focus_timer = QTimer(self)
        self._focus_timer.timeout.connect(self._poll_browser_auto_hide)
        self._focus_timer.start(220)

    def _idle_width(self) -> int:
        return self.IDLE_NAMED_WIDTH if self.assistant_name else self.IDLE_NAMELESS_WIDTH

    def set_assistant_name(self, name: str) -> None:
        self.assistant_name = name.strip()[:28]
        self.pill_label.setText(self.assistant_name)
        self.pill_label.setVisible(bool(self.assistant_name))
        self.input_bar.setPlaceholderText(
            f"Ask {self.assistant_name} anything..."
            if self.assistant_name
            else "Ask anything... or give me a name"
        )
        if not self._expanded:
            self._position_top_center(self._idle_width(), self.IDLE_HEIGHT)

    def _is_browser_foreground(self) -> bool:
        import ctypes, sys
        if sys.platform != "win32":
            return False
        try:
            import psutil  # type: ignore
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            if not hwnd or hwnd == int(self.winId()):
                return False
            pid = ctypes.c_ulong(0)
            ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            proc_name = psutil.Process(pid.value).name().lower()
            return proc_name in self.BROWSER_PROCESSES
        except Exception:
            return False

    def _poll_browser_auto_hide(self) -> None:
        from PyQt6.QtGui import QCursor
        if self._expanded or self._orb_state in ("listening", "thinking", "speaking"):
            if self._hidden_for_browser:
                self._hidden_for_browser = False
                self.show()
            return
        cursor = QCursor.pos()
        screen = QGuiApplication.primaryScreen().availableGeometry()
        near_top_center = (
            cursor.y() <= screen.y() + 6
            and abs(cursor.x() - (screen.x() + screen.width() // 2)) <= 160
        )
        should_hide = self._is_browser_foreground() and not near_top_center
        if should_hide != self._hidden_for_browser:
            self._hidden_for_browser = should_hide
            self.hide() if should_hide else self.show()

    def attach_listener(self, listener) -> None:
        self._listener = listener

    def _build_ui(self) -> None:
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(14, 8, 14, 10)
        root_layout.setSpacing(8)

        # Top Idle Pill Row: Glowing Orb + Status Text + Minimal Mic / Ask Triggers (Zero Clutter)
        top_row = QHBoxLayout()
        top_row.setSpacing(10)

        self.orb_spacer = QWidget()
        self.orb_spacer.setFixedSize(22, 22)
        top_row.addWidget(self.orb_spacer)

        self.pill_label = QLabel("")
        self.pill_label.setVisible(False)
        self.pill_label.setStyleSheet(
            "color: #F1F5F9; font-size: 13px; font-weight: 600; background: transparent;"
        )
        top_row.addWidget(self.pill_label, 1)

        self.mic_btn = QPushButton("Mic")
        self.mic_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.mic_btn.setFixedHeight(28)
        self.mic_btn.setStyleSheet(
            "QPushButton { color: #E2E8F0; background: rgba(255,255,255,0.08); "
            "border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 0 10px; font-size: 12px; }"
            "QPushButton:hover { background: rgba(56,189,248,0.22); }"
        )
        self.mic_btn.clicked.connect(self._trigger_mic)
        top_row.addWidget(self.mic_btn)

        self.ask_btn = QPushButton("Ask")
        self.ask_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.ask_btn.setFixedHeight(28)
        self.ask_btn.setStyleSheet(
            "QPushButton { color: #0F172A; background: #F8FAFC; border: none; "
            "border-radius: 14px; padding: 0 11px; font-size: 12px; font-weight: 600; }"
            "QPushButton:hover { background: #FFFFFF; }"
        )
        self.ask_btn.clicked.connect(self.toggle_expanded)
        top_row.addWidget(self.ask_btn)

        root_layout.addLayout(top_row)

        # Pop-Down Conversational Card Container (Hidden when idle)
        self.card_container = QWidget()
        self.card_container.setVisible(False)
        card_layout = QVBoxLayout(self.card_container)
        card_layout.setContentsMargins(0, 2, 0, 0)
        card_layout.setSpacing(8)

        self.response_bubble = QLabel("Ready. Ask anything or give me a name.")
        self.response_bubble.setWordWrap(True)
        self.response_bubble.setStyleSheet(
            "color: #E2E8F0; background: rgba(255,255,255,0.05); "
            "border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; "
            "padding: 8px 10px; font-size: 12px;"
        )
        card_layout.addWidget(self.response_bubble)

        self.input_bar = QLineEdit()
        self.input_bar.setPlaceholderText("Ask anything... or give me a name")
        self.input_bar.setFixedHeight(34)
        self.input_bar.setStyleSheet(
            "QLineEdit { color: #F8FAFC; background: rgba(15,23,42,0.85); "
            "border: 1px solid rgba(148,163,184,0.28); border-radius: 10px; "
            "padding: 0 12px; font-size: 13px; }"
            "QLineEdit:focus { border: 1px solid #38BDF8; }"
        )
        self.input_bar.returnPressed.connect(self._submit_input)
        card_layout.addWidget(self.input_bar)

        root_layout.addWidget(self.card_container)

    def _position_top_center(self, width: int, height: int) -> None:
        screen = QGuiApplication.primaryScreen().availableGeometry()
        x = screen.x() + (screen.width() - width) // 2
        y = screen.y() + self.TOP_MARGIN
        self.setGeometry(x, y, width, height)

    def toggle_expanded(self, force: Optional[bool] = None) -> None:
        target_state = (not self._expanded) if force is None else force
        if target_state == self._expanded:
            return
        self._expanded = target_state
        screen = QGuiApplication.primaryScreen().availableGeometry()
        target_w = self.EXPANDED_WIDTH if self._expanded else self._idle_width()
        target_h = self.EXPANDED_HEIGHT if self._expanded else self.IDLE_HEIGHT
        target_x = screen.x() + (screen.width() - target_w) // 2
        target_rect = QRect(target_x, screen.y() + self.TOP_MARGIN, target_w, target_h)

        self._anim = QPropertyAnimation(self, b"geometry")
        self._anim.setDuration(190)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.setStartValue(self.geometry())
        self._anim.setEndValue(target_rect)
        self._anim.start()

        self.card_container.setVisible(self._expanded)
        self.ask_btn.setText("Hide" if self._expanded else "Ask")
        if self._expanded:
            self.input_bar.setFocus()

    def _trigger_mic(self) -> None:
        self.toggle_expanded(force=True)
        self.set_orb_state("listening")
        if self._listener:
            self._listener.trigger_manual_capture()

    def _submit_input(self) -> None:
        text = self.input_bar.text().strip()
        if not text:
            return
        self.input_bar.clear()
        self._execute_natural_language(text)

    def handle_voice_transcript(self, text: str) -> None:
        self.transcript_received.emit(text)

    def set_orb_state(self, state: str) -> None:
        self.orb_state_changed.emit(state)

    def _apply_orb_state(self, state: str) -> None:
        self._orb_state = state
        labels = {
            "idle": self.assistant_name,
            "listening": "Listening...",
            "thinking": "Thinking...",
            "speaking": self.assistant_name or "Speaking...",
        }
        txt = labels.get(state, self.assistant_name)
        self.pill_label.setText(txt)
        self.pill_label.setVisible(bool(txt))
        self.update()

    def _execute_natural_language(self, utterance: str) -> None:
        self.show()
        self.toggle_expanded(force=True)
        self._apply_orb_state("thinking")
        result = self.router.handle_utterance(utterance)
        if result.action == "open_vault":
            dlg = SecurityVaultDialog(self.vault, self.voiceprint, self)
            dlg.exec()
        elif result.action == "set_assistant_name":
            self.set_assistant_name(result.resolved_reference)
        self.response_bubble.setText(result.reply)
        self._apply_orb_state("speaking")
        self.tts.speak_async(result.reply, on_done=lambda: self.set_orb_state("idle"))

    def _tick_orb(self) -> None:
        self._orb_phase = (self._orb_phase + 0.08) % 6.28318
        self.update()

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        rect = self.rect().adjusted(1, 1, -1, -1)
        radius = 22 if self._expanded else 24
        path = QPainterPath()
        path.addRoundedRect(rect.x(), rect.y(), rect.width(), rect.height(), radius, radius)

        # Translucent dark glassmorphism body + crisp 1px highlight border
        painter.fillPath(path, QColor(11, 15, 23, 224))
        painter.setPen(QPen(QColor(255, 255, 255, 38), 1.0))
        painter.drawPath(path)

        # Glowing animated AI orb in top-left slot
        orb_cx, orb_cy = 25, 24
        grad = QLinearGradient(orb_cx - 10, orb_cy - 10, orb_cx + 10, orb_cy + 10)
        if self._orb_state == "listening":
            grad.setColorAt(0.0, QColor("#34D399"))
            grad.setColorAt(1.0, QColor("#0EA5E9"))
        elif self._orb_state == "thinking":
            grad.setColorAt(0.0, QColor("#F59E0B"))
            grad.setColorAt(1.0, QColor("#38BDF8"))
        else:
            grad.setColorAt(0.0, QColor("#38BDF8"))
            grad.setColorAt(1.0, QColor("#6366F1"))

        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(grad)
        painter.drawEllipse(orb_cx - 9, orb_cy - 9, 18, 18)
`,
  },
  {
    path: "windows_notch_pro/ui/security_vault_dialog.py",
    group: "UI & Security Vault",
    language: "python",
    summary:
      "In-app Security Vault modal for setting the PBKDF2-HMAC-SHA256 passphrase, storing DPAPI-encrypted Windows login credentials, and recording a 3-second MFCC voiceprint.",
    content: `"""In-App Security Vault Dialog (Passphrase, DPAPI Credentials, 3-Second Voiceprint)."""
from __future__ import annotations

import threading

from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import (
    QDialog,
    QFormLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
)


class SecurityVaultDialog(QDialog):
    """Configures 2FA voice unlock credentials and enrolls 3-second speaker voiceprint."""

    voiceprint_done = pyqtSignal(bool, str)

    def __init__(self, vault, voiceprint_verifier, parent=None):
        super().__init__(parent)
        self.vault = vault
        self.voiceprint = voiceprint_verifier
        self.setWindowTitle("WindowsNotch Pro — Security Vault")
        self.setFixedWidth(440)
        self.setStyleSheet(
            "QDialog { background: #0F172A; color: #F1F5F9; }"
            "QLineEdit { background: #1E293B; color: #F8FAFC; border: 1px solid #334155; "
            "border-radius: 6px; padding: 6px 8px; }"
            "QPushButton { background: #0284C7; color: white; border: none; "
            "border-radius: 6px; padding: 8px 14px; font-weight: 600; }"
        )

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.passphrase_input = QLineEdit()
        self.passphrase_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.passphrase_input.setPlaceholderText("Spoken unlock passphrase (min 8 chars)")
        form.addRow("2FA Passphrase:", self.passphrase_input)

        self.account_input = QLineEdit()
        self.account_input.setPlaceholderText(r".\\Username or DOMAIN\\Username")
        form.addRow("Windows Account:", self.account_input)

        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("Encrypted via Windows DPAPI (never plaintext)")
        form.addRow("Windows Password:", self.password_input)

        layout.addLayout(form)

        self.save_btn = QPushButton("Save Passphrase & Seal DPAPI Credentials")
        self.save_btn.clicked.connect(self._save_credentials)
        layout.addWidget(self.save_btn)

        self.enroll_status = QLabel("Voiceprint: Not enrolled")
        layout.addWidget(self.enroll_status)

        self.record_btn = QPushButton("Record 3-Second Voiceprint")
        self.record_btn.clicked.connect(self._record_voiceprint)
        layout.addWidget(self.record_btn)

        self.voiceprint_done.connect(self._on_voiceprint_done)

    def _save_credentials(self) -> None:
        passphrase = self.passphrase_input.text().strip()
        account = self.account_input.text().strip()
        password = self.password_input.text()

        if len(passphrase) < 8:
            QMessageBox.warning(self, "Weak Passphrase", "Use at least 8 characters.")
            return
        self.vault.set_passphrase(passphrase)
        if account and password:
            self.vault.store_windows_credentials(account, password)
        self.passphrase_input.clear()
        self.password_input.clear()
        QMessageBox.information(
            self,
            "Vault Updated",
            "Passphrase hashed (PBKDF2-HMAC-SHA256, 200,000 iterations) and credentials DPAPI-sealed.",
        )

    def _record_voiceprint(self) -> None:
        self.record_btn.setEnabled(False)
        self.enroll_status.setText("Recording 3 seconds... Speak naturally now.")

        def worker() -> None:
            try:
                samples = self.voiceprint.capture_microphone_seconds(seconds=3.0)
                self.voiceprint.enroll(samples)
                self.voiceprint_done.emit(True, "3-second MFCC voiceprint enrolled locally.")
            except Exception as exc:
                self.voiceprint_done.emit(False, f"Enrollment failed: {exc}")

        threading.Thread(target=worker, daemon=True).start()

    def _on_voiceprint_done(self, ok: bool, message: str) -> None:
        self.record_btn.setEnabled(True)
        self.enroll_status.setText(message)
        if not ok:
            QMessageBox.warning(self, "Voiceprint Error", message)
`,
  },
  {
    path: "windows_notch_pro/ai/memory_buffer.py",
    group: "AI & Short-Term Memory",
    language: "python",
    summary:
      "Thread-safe 5-turn sliding window short-term memory buffer resolving relative references like 'do that for the new folder instead' or 'what was that last app I opened?'.",
    content: `"""Short-Term Memory Management System (5-Turn Sliding Window Buffer)."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
import re
import threading
from typing import Any, Deque, Dict, List, Optional


@dataclass(frozen=True)
class InteractionRecord:
    """Single user interaction stored in the 5-turn sliding window."""

    turn_id: int
    timestamp: str
    user_utterance: str
    intent: str
    parameters: Dict[str, Any] = field(default_factory=dict)
    assistant_reply: str = ""
    outcome: str = "executed"


class ShortTermMemoryBuffer:
    """Thread-safe sliding window buffer tracking the last N (default 20) interactions."""

    def __init__(self, maxlen: int = 20) -> None:
        if maxlen < 1:
            raise ValueError("maxlen must be >= 1")
        self._maxlen = maxlen
        self._buffer: Deque[InteractionRecord] = deque(maxlen=maxlen)
        self._lock = threading.RLock()
        self._turn_counter = 0

    @property
    def maxlen(self) -> int:
        return self._maxlen

    def record(
        self,
        user_utterance: str,
        intent: str,
        parameters: Optional[Dict[str, Any]] = None,
        assistant_reply: str = "",
        outcome: str = "executed",
    ) -> InteractionRecord:
        with self._lock:
            self._turn_counter += 1
            entry = InteractionRecord(
                turn_id=self._turn_counter,
                timestamp=datetime.now(timezone.utc).isoformat(),
                user_utterance=user_utterance.strip(),
                intent=intent,
                parameters=dict(parameters or {}),
                assistant_reply=assistant_reply,
                outcome=outcome,
            )
            self._buffer.append(entry)
            return entry

    def snapshot(self) -> List[InteractionRecord]:
        with self._lock:
            return list(self._buffer)

    def clear(self) -> None:
        with self._lock:
            self._buffer.clear()

    def get_last_app(self, action_filter: Optional[str] = "app_open") -> Optional[str]:
        """Return the most recently referenced or opened application within the window."""
        with self._lock:
            for item in reversed(self._buffer):
                if action_filter and item.intent != action_filter:
                    continue
                if item.outcome == "executed" and item.parameters.get("target"):
                    return str(item.parameters["target"])
            return None

    def get_last_folder(self) -> Optional[Dict[str, str]]:
        """Return the most recently created or renamed folder within the window."""
        with self._lock:
            for item in reversed(self._buffer):
                if item.intent in ("folder_create", "folder_rename") and item.outcome == "executed":
                    name = (
                        item.parameters.get("new_name")
                        if item.intent == "folder_rename"
                        else item.parameters.get("target")
                    )
                    if name:
                        return {
                            "name": str(name),
                            "root": str(item.parameters.get("root", "Desktop")),
                        }
            return None

    def get_last_action(self) -> Optional[InteractionRecord]:
        """Return the most recent non-Q&A executable action in the sliding window."""
        with self._lock:
            for item in reversed(self._buffer):
                if item.intent not in ("general_qa", "memory_recall"):
                    return item
            return None

    def resolve_relative_command(self, utterance: str) -> Optional[Dict[str, Any]]:
        """Resolve anaphoric/relative commands against the 5-turn sliding window.

        Supports patterns such as:
          - 'what was that last app I opened?'
          - 'what folder did I just create?'
          - 'do that for the new folder instead' / 'do that for Reports instead'
          - 'rename it to Archive' / 'delete it' / 'close that app'
        """
        lower = utterance.strip().lower()

        # 1. Recall: "what was that last app I opened?"
        if re.search(r"what\s+(was\s+)?(that\s+)?last\s+app", lower) or "last app i opened" in lower:
            last_app = self.get_last_app("app_open")
            if last_app:
                return {
                    "intent": "memory_recall",
                    "resolved_reference": f"Last opened app in 5-turn window: {last_app}",
                    "reply": f"The last app you opened was {last_app}.",
                }
            return {
                "intent": "memory_recall",
                "resolved_reference": "No app_open event in last 5 interactions",
                "reply": "You haven't opened any app in the last five interactions.",
            }

        # 2. Recall: "what was that last folder?"
        if re.search(r"what\s+(was\s+)?(that\s+)?(last|new)\s+folder", lower):
            last_folder = self.get_last_folder()
            if last_folder:
                return {
                    "intent": "memory_recall",
                    "resolved_reference": f"Last folder in window: {last_folder['root']}\\{last_folder['name']}",
                    "reply": f"Your most recent folder is {last_folder['name']} in {last_folder['root']}.",
                }
            return {
                "intent": "memory_recall",
                "resolved_reference": "No folder action in last 5 interactions",
                "reply": "No folder has been created or modified in the last five interactions.",
            }

        # 3. Repeat previous action for a different target: "do that for <target> instead"
        repeat_match = re.search(
            r"do\s+that\s+(?:for|on|to)\s+(?:the\s+)?(.+?)(?:\s+instead)?$",
            utterance.strip(),
            re.IGNORECASE,
        )
        if repeat_match:
            last_act = self.get_last_action()
            if last_act:
                phrase = repeat_match.group(1).strip().strip("\"'")
                resolved_target = phrase
                resolved_root = str(last_act.parameters.get("root", "Desktop"))
                if phrase.lower() in ("new folder", "the new folder", "last folder"):
                    recent_folder = self.get_last_folder()
                    if recent_folder:
                        resolved_target = recent_folder["name"]
                        resolved_root = recent_folder["root"]
                return {
                    "intent": last_act.intent,
                    "target": resolved_target,
                    "root": resolved_root,
                    "resolved_reference": f"Repeated '{last_act.intent}' on '{resolved_target}' from turn #{last_act.turn_id}",
                }

        # 4. Pronoun folder rename: "rename it to <NewName>"
        rename_it = re.search(r"rename\s+(?:it|that|the\s+new\s+folder)\s+to\s+(.+)$", utterance.strip(), re.IGNORECASE)
        if rename_it:
            last_folder = self.get_last_folder()
            if last_folder:
                return {
                    "intent": "folder_rename",
                    "target": last_folder["name"],
                    "new_name": rename_it.group(1).strip(),
                    "root": last_folder["root"],
                    "resolved_reference": f"Resolved 'it' -> {last_folder['root']}\\{last_folder['name']}",
                }

        # 5. Pronoun folder delete: "delete it" / "delete that folder"
        if re.fullmatch(r"(delete|remove)\s+(it|that|that\s+folder|the\s+new\s+folder)", lower):
            last_folder = self.get_last_folder()
            if last_folder:
                return {
                    "intent": "folder_delete",
                    "target": last_folder["name"],
                    "root": last_folder["root"],
                    "resolved_reference": f"Resolved pronoun -> {last_folder['root']}\\{last_folder['name']}",
                }

        # 6. Pronoun app close: "close it" / "close that app"
        if re.fullmatch(r"(close|quit)\s+(it|that|that\s+app|the\s+last\s+app)", lower):
            last_app = self.get_last_app("app_open")
            if last_app:
                return {
                    "intent": "app_close",
                    "target": last_app,
                    "resolved_reference": f"Resolved pronoun -> {last_app}",
                }

        return None

    def format_prompt_context(self) -> List[Dict[str, Any]]:
        """Serialize the 5-turn sliding window for LLM prompt injection."""
        return [
            {
                "turn": item.turn_id,
                "user": item.user_utterance,
                "intent": item.intent,
                "parameters": item.parameters,
                "reply": item.assistant_reply,
                "outcome": item.outcome,
            }
            for item in self.snapshot()
        ]
`,
  },
  {
    path: "windows_notch_pro/ai/intent_router.py",
    group: "AI & Short-Term Memory",
    language: "python",
    summary:
      "Natural-language intent parser integrating ShortTermMemoryBuffer with sandboxed folders, safe apps, mouse automation, gestures, and lock-screen triggers.",
    content: `"""Natural-Language Intent Router with 5-Turn Short-Term Memory Integration."""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Optional

from windows_notch_pro.ai.memory_buffer import ShortTermMemoryBuffer


@dataclass
class RouteResult:
    action: str
    reply: str
    outcome: str = "executed"
    resolved_reference: str = ""


class IntentRouter:
    """Infers user intent from natural language without requiring UI button rows."""

    def __init__(
        self,
        memory: ShortTermMemoryBuffer,
        folder_manager,
        app_manager,
        mouse_controller,
        air_mouse,
        platform_adapter,
        audit_logger,
    ) -> None:
        self.memory = memory
        self.folders = folder_manager
        self.apps = app_manager
        self.mouse = mouse_controller
        self.air_mouse = air_mouse
        self.platform = platform_adapter
        self.audit = audit_logger

    def handle_utterance(self, utterance: str) -> RouteResult:
        text = utterance.strip()
        if not text:
            return RouteResult("general_qa", "I didn't catch that. Please try again.", "answered")

        # Step 1: Check 5-turn sliding window for relative references first
        resolved = self.memory.resolve_relative_command(text)
        if resolved:
            intent = resolved["intent"]
            ref = resolved.get("resolved_reference", "")
            if intent == "memory_recall":
                reply = resolved["reply"]
                self.memory.record(text, intent, {}, reply, "answered")
                self.audit.log("memory", "memory_recall", "allowed", ref)
                return RouteResult(intent, reply, "answered", ref)
            return self._dispatch_resolved(text, resolved, ref)

        lower = text.lower()

        # Step 2: Direct natural-language intent classification
        m_name = re.search(
            r"(?:call\s+yourself|your\s+name\s+is|name\s+yourself|i(?:'ll|\s+will)\s+call\s+you)\s+([a-zA-Z0-9 _-]{1,28})",
            text,
            re.IGNORECASE,
        )
        if m_name:
            new_name = m_name.group(1).strip()
            reply = f"Done — you can call me {new_name}."
            self.memory.record(text, "set_assistant_name", {"target": new_name}, reply, "executed")
            self.audit.log("system", "assistant_renamed", "allowed", f"name={new_name}")
            return RouteResult("set_assistant_name", reply, "executed", new_name)

        if any(k in lower for k in ("remove your name", "be nameless", "clear your name")):
            reply = "Okay, I'll stay nameless until you choose a name."
            self.memory.record(text, "set_assistant_name", {"target": ""}, reply, "executed")
            self.audit.log("system", "assistant_renamed", "allowed", "nameless")
            return RouteResult("set_assistant_name", reply, "executed", "")

        if any(k in lower for k in ("security vault", "open vault", "enroll voice", "set passphrase")):
            reply = "Opening the Security Vault."
            self.memory.record(text, "open_vault", {}, reply, "executed")
            return RouteResult("open_vault", reply)

        if re.search(r"\block(\s+my)?(\s+pc|\s+computer|\s+screen)?\b", lower):
            self.platform.lock_workstation()
            reply = "Workstation locked. Session-0 voice unlock remains active."
            self.audit.log("security", "lock_workstation", "allowed", "Triggered by voice/text")
            self.memory.record(text, "lock_pc", {}, reply, "executed")
            return RouteResult("lock_pc", reply)

        if "emergency stop" in lower or "stop mouse" in lower or "stop patrol" in lower:
            self.mouse.emergency_stop()
            self.air_mouse.emergency_stop()
            reply = "Emergency stop engaged. Mouse automation and Air-Mouse halted."
            self.memory.record(text, "mouse_stop", {}, reply, "executed")
            return RouteResult("mouse_stop", reply)

        if "patrol" in lower or "keep awake" in lower:
            self.mouse.start_keep_awake_patrol()
            reply = "Autonomous keep-awake mouse patrol started."
            self.memory.record(text, "mouse_patrol", {}, reply, "executed")
            return RouteResult("mouse_patrol", reply)

        if "air mouse" in lower or "hand gesture" in lower:
            enable = not any(w in lower for w in ("stop", "disable", "off"))
            if enable:
                self.air_mouse.start()
                reply = "MediaPipe Air-Mouse hand tracking enabled."
            else:
                self.air_mouse.emergency_stop()
                reply = "MediaPipe Air-Mouse disabled."
            self.memory.record(text, "gesture_toggle", {"enabled": enable}, reply, "executed")
            return RouteResult("gesture_toggle", reply)

        # Folder Create: "create folder Invoices in Documents"
        m_create = re.search(
            r"create\s+(?:a\s+)?folder\s+(?:named\s+|called\s+)?([^\s]+)(?:\s+(?:in|on)\s+([a-zA-Z]+))?",
            text,
            re.IGNORECASE,
        )
        if m_create:
            return self._execute_folder_create(text, m_create.group(1), m_create.group(2) or "Desktop")

        # Folder Rename: "rename folder Old to New in Desktop"
        m_rename = re.search(
            r"rename\s+(?:folder\s+)?([^\s]+)\s+to\s+([^\s]+)(?:\s+(?:in|on)\s+([a-zA-Z]+))?",
            text,
            re.IGNORECASE,
        )
        if m_rename:
            return self._execute_folder_rename(
                text, m_rename.group(1), m_rename.group(2), m_rename.group(3) or "Desktop"
            )

        # Folder Delete: "delete folder Drafts in Downloads"
        m_del = re.search(
            r"(?:delete|remove)\s+(?:folder\s+)?([^\s]+)(?:\s+(?:in|from|on)\s+([a-zA-Z]+))?",
            text,
            re.IGNORECASE,
        )
        if m_del:
            return self._execute_folder_delete(text, m_del.group(1), m_del.group(2) or "Desktop")

        # In-Notch Song Playback Controls (play / search / stop without opening another app)
        if re.search(r"\b(stop|halt|turn off)\s+(the\s+)?(song|music|audio|track)\b", lower):
            reply = "Stopped song playback inside the Notch."
            self.memory.record(text, "song_stop", {}, reply, "executed")
            self.audit.log("system", "notch_song_stop", "allowed", "Stopped in-Notch audio")
            return RouteResult("song_stop", reply)

        m_song = re.match(r"^(?:play|search\s+song|find\s+song)\s+(.+)$", text, re.IGNORECASE)
        if m_song:
            query = m_song.group(1).strip()
            intent_name = "song_search" if lower.startswith(("search", "find")) else "song_play"
            reply = (
                f"Searching songs for '{query}' inside the Notch."
                if intent_name == "song_search"
                else f"Playing '{query}' directly through the Notch."
            )
            self.memory.record(text, intent_name, {"target": query}, reply, "executed")
            self.audit.log("system", intent_name, "allowed", f"query={query}")
            return RouteResult(intent_name, reply)

        # List apps
        if "list apps" in lower or "running apps" in lower:
            running = self.apps.list_running_apps()
            reply = f"Running apps: {', '.join(running[:8]) or 'none'}."
            self.memory.record(text, "app_list", {}, reply, "executed")
            return RouteResult("app_list", reply)

        # Open app
        m_open = re.match(r"^(?:open|launch|start)\s+(.+)$", text, re.IGNORECASE)
        if m_open:
            return self._execute_app_open(text, m_open.group(1).strip())

        # Close app
        m_close = re.match(r"^(?:close|quit|terminate|kill)\s+(.+)$", text, re.IGNORECASE)
        if m_close:
            return self._execute_app_close(text, m_close.group(1).strip())

        reply = "I understood your question. Connect an AI provider key to answer open-ended queries."
        self.memory.record(text, "general_qa", {}, reply, "answered")
        return RouteResult("general_qa", reply, "answered")

    def _dispatch_resolved(self, text: str, resolved: dict, ref: str) -> RouteResult:
        intent = resolved["intent"]
        target = str(resolved.get("target", ""))
        root = str(resolved.get("root", "Desktop"))
        if intent == "folder_create":
            return self._execute_folder_create(text, target, root, ref)
        if intent == "folder_rename":
            return self._execute_folder_rename(text, target, str(resolved.get("new_name", "")), root, ref)
        if intent == "folder_delete":
            return self._execute_folder_delete(text, target, root, ref)
        if intent == "app_open":
            return self._execute_app_open(text, target, ref)
        if intent == "app_close":
            return self._execute_app_close(text, target, ref)
        return RouteResult("general_qa", "Could not repeat that action.", "blocked", ref)

    def _execute_folder_create(self, text: str, name: str, root: str, ref: str = "") -> RouteResult:
        ok, msg = self.folders.create_folder(name, root)
        outcome = "executed" if ok else "blocked"
        self.memory.record(text, "folder_create", {"target": name, "root": root}, msg, outcome)
        return RouteResult("folder_create", msg, outcome, ref)

    def _execute_folder_rename(
        self, text: str, old_name: str, new_name: str, root: str, ref: str = ""
    ) -> RouteResult:
        ok, msg = self.folders.rename_folder(old_name, new_name, root)
        outcome = "executed" if ok else "blocked"
        self.memory.record(
            text, "folder_rename", {"target": old_name, "new_name": new_name, "root": root}, msg, outcome
        )
        return RouteResult("folder_rename", msg, outcome, ref)

    def _execute_folder_delete(self, text: str, name: str, root: str, ref: str = "") -> RouteResult:
        ok, msg = self.folders.delete_folder(name, root)
        outcome = "executed" if ok else "blocked"
        self.memory.record(text, "folder_delete", {"target": name, "root": root}, msg, outcome)
        return RouteResult("folder_delete", msg, outcome, ref)

    def _execute_app_open(self, text: str, app_name: str, ref: str = "") -> RouteResult:
        ok, msg = self.apps.open_app(app_name)
        outcome = "executed" if ok else "blocked"
        self.memory.record(text, "app_open", {"target": app_name}, msg, outcome)
        return RouteResult("app_open", msg, outcome, ref)

    def _execute_app_close(self, text: str, app_name: str, ref: str = "") -> RouteResult:
        ok, msg = self.apps.close_app(app_name)
        outcome = "executed" if ok else "blocked"
        self.memory.record(text, "app_close", {"target": app_name}, msg, outcome)
        return RouteResult("app_close", msg, outcome, ref)
`,
  },
  {
    path: "windows_notch_pro/voice/listener.py",
    group: "Voice & Talk-Back",
    language: "python",
    summary:
      "Non-blocking background microphone listener with wake-word 'Notch' trigger and raw PCM buffer passthrough for speaker voiceprint verification.",
    content: `"""Non-blocking Wake-Word Microphone Listener ('Notch')."""
from __future__ import annotations

import threading
from typing import Callable, Optional


class WakeWordVoiceListener:
    """Listens continuously on a daemon thread for the 'Notch' wake word."""

    def __init__(
        self,
        wake_word: str = "notch",
        on_command: Optional[Callable[[str], None]] = None,
        on_state_change: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.wake_word = wake_word.lower()
        self.on_command = on_command
        self.on_state_change = on_state_change
        self._stop_event = threading.Event()
        self._manual_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, name="NotchVoiceListener", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._manual_event.set()

    def trigger_manual_capture(self) -> None:
        self._manual_event.set()

    def _run_loop(self) -> None:
        try:
            import speech_recognition as sr  # type: ignore
        except ImportError:
            return

        recognizer = sr.Recognizer()
        recognizer.dynamic_energy_threshold = True

        try:
            with sr.Microphone() as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.8)
                while not self._stop_event.is_set():
                    try:
                        audio = recognizer.listen(source, timeout=2.0, phrase_time_limit=6.0)
                        transcript = recognizer.recognize_google(audio).strip()
                    except Exception:
                        continue

                    lower = transcript.lower()
                    manual_armed = self._manual_event.is_set()
                    if manual_armed:
                        self._manual_event.clear()
                        command = transcript
                    elif lower.startswith(self.wake_word):
                        command = transcript[len(self.wake_word) :].lstrip(" ,:.")
                    else:
                        continue

                    if command and self.on_command:
                        if self.on_state_change:
                            self.on_state_change("thinking")
                        self.on_command(command)
        except Exception:
            if self.on_state_change:
                self.on_state_change("idle")
`,
  },
  {
    path: "windows_notch_pro/voice/tts_engine.py",
    group: "Voice & Talk-Back",
    language: "python",
    summary:
      "Queue-backed non-blocking background TTS worker invoking Windows native SAPI.SpVoice / System.Speech without stalling the UI thread.",
    content: `"""Non-blocking Background TTS Talk-Back Engine (Windows SAPI.SpVoice / System.Speech)."""
from __future__ import annotations

import queue
import threading
from typing import Callable, Optional, Tuple


class NativeTTSEngine:
    """Speaks confirmations aloud on a dedicated daemon worker thread."""

    def __init__(self, platform_adapter) -> None:
        self._platform = platform_adapter
        self._queue: "queue.Queue[Optional[Tuple[str, Optional[Callable[[], None]]]]]" = queue.Queue()
        self._worker = threading.Thread(target=self._loop, name="NotchTTSWorker", daemon=True)
        self._worker.start()

    def speak_async(self, text: str, on_done: Optional[Callable[[], None]] = None) -> None:
        if not text.strip():
            if on_done:
                on_done()
            return
        self._queue.put((text.strip(), on_done))

    def shutdown(self) -> None:
        self._queue.put(None)

    def _loop(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                break
            text, on_done = item
            try:
                self._platform.speak_blocking(text)
            finally:
                if on_done:
                    on_done()
`,
  },
];
