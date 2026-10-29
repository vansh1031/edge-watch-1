"""
compat.py — Windows + Linux (Jetson) helpers
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Windows writes console / redirected output as cp1252, which cannot encode the
✅ 🔴 ⚠️ used in our prints → UnicodeEncodeError at startup. Force UTF-8.
"""

import os
import sys


def utf8_console():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def run_from_backend_dir():
    """Training / research scripts use relative paths — make them work from any folder."""
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
