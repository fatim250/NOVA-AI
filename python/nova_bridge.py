"""NOVA Python Helper Bridge (bundled in NOVA-v2.0.0-win-x64/python/).

Provides optional Python-side utilities for sandboxed folder management,
PBKDF2-HMAC-SHA256 (200k rounds) verification, and JSON-RPC commands
callable by NOVA.exe.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

ALLOWED_ROOTS = {
    "desktop": Path.home() / "Desktop",
    "documents": Path.home() / "Documents",
    "downloads": Path.home() / "Downloads",
}

RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def resolve_sandbox_path(folder_name: str, root_key: str = "desktop") -> Path:
    root = ALLOWED_ROOTS.get(root_key.strip().lower())
    if root is None:
        raise ValueError("Sandbox allows only Desktop, Documents, or Downloads.")

    clean = folder_name.strip()
    if not clean or len(clean) > 120:
        raise ValueError("Folder name must be 1 to 120 characters.")
    if any(token in clean for token in ("..", "/", "\\", ":")):
        raise ValueError("Path traversal and drive prefixes are blocked.")
    if clean.split(".")[0].upper() in RESERVED_NAMES:
        raise ValueError(f"Reserved Windows name blocked: {clean}")

    root_resolved = root.resolve()
    candidate = (root_resolved / clean).resolve()
    if not str(candidate).lower().startswith(str(root_resolved).lower() + os.sep):
        raise ValueError("Resolved path escaped sandbox boundary.")
    return candidate


def verify_pbkdf2(passphrase: str, salt_hex: str, expected_hex: str, rounds: int = 200_000) -> bool:
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        passphrase.encode("utf-8"),
        bytes.fromhex(salt_hex),
        rounds,
    ).hex()
    return hmac.compare_digest(derived, expected_hex)


def handle_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    cmd = str(payload.get("cmd", "")).strip().lower()
    if cmd == "ping":
        return {"ok": True, "service": "nova-python-bridge", "version": "2.0.0"}
    if cmd == "list_folders":
        root_key = str(payload.get("root", "desktop")).lower()
        root = ALLOWED_ROOTS.get(root_key)
        if not root or not root.exists():
            return {"ok": True, "folders": []}
        folders = sorted(p.name for p in root.iterdir() if p.is_dir() and not p.is_symlink())
        return {"ok": True, "folders": folders}
    if cmd == "create_folder":
        target = resolve_sandbox_path(str(payload.get("name", "")), str(payload.get("root", "desktop")))
        target.mkdir(parents=False, exist_ok=False)
        return {"ok": True, "path": str(target)}
    return {"ok": False, "error": f"Unknown bridge command: {cmd}"}


def main() -> int:
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            resp = handle_request(req if isinstance(req, dict) else {})
        except Exception as exc:
            resp = {"ok": False, "error": str(exc)}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
