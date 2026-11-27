"""NOVA Python Helper Bridge (bundled in NOVA-v2.0.0-win-x64/python/)."""
import hashlib, hmac, json, os, sys
from pathlib import Path

ALLOWED_ROOTS = {
    "desktop": Path.home() / "Desktop",
    "documents": Path.home() / "Documents",
    "downloads": Path.home() / "Downloads",
}

def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            cmd = str(req.get("cmd", "")).lower()
            if cmd == "ping":
                resp = {"ok": True, "service": "nova-python-bridge", "version": "2.0.0"}
            else:
                resp = {"ok": False, "error": f"Unknown command: {cmd}"}
        except Exception as exc:
            resp = {"ok": False, "error": str(exc)}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
