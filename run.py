#!/usr/bin/env python3
"""
run.py — start Edge Watch with one command on Windows or Linux / Jetson
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  python run.py              set up (first time / after updates) and start backend + dashboard
  python run.py --backend    only the Flask backend   (port 5005)
  python run.py --frontend   only the dashboard        (port 8080)
  python run.py --setup      only install / update dependencies

Windows: use `py run.py` if `python` is not found.
Needs Python 3.11+ and Node.js 18+. Stop with Ctrl+C.
"""

import argparse
import hashlib
import os
import shutil
import socket
import subprocess
import sys
import time

ROOT     = os.path.dirname(os.path.abspath(__file__))
BACKEND  = os.path.join(ROOT, "backend")
VENV     = os.path.join(BACKEND, "venv")
WINDOWS  = os.name == "nt"
VENV_PY  = os.path.join(VENV, "Scripts", "python.exe") if WINDOWS else os.path.join(VENV, "bin", "python")
REQS     = os.path.join(BACKEND, "requirements.txt")


def say(msg):
    print(f"[run] {msg}", flush=True)


def fail(msg):
    say(f"ERROR: {msg}")
    sys.exit(1)


def file_hash(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


# ─── Setup ────────────────────────────────────────────────────
def setup_backend():
    if sys.version_info < (3, 11):
        fail(f"Python 3.11 or newer is needed (this is {sys.version.split()[0]}).")
    if not os.path.isfile(VENV_PY):
        say("Creating Python environment backend/venv …")
        subprocess.run([sys.executable, "-m", "venv", VENV], check=True)

    # Re-install only when requirements.txt changed
    marker = os.path.join(VENV, ".requirements.sha256")
    wanted = file_hash(REQS)
    if not os.path.isfile(marker) or open(marker).read().strip() != wanted:
        say("Installing Python packages (first time can take several minutes on the Jetson) …")
        subprocess.run([VENV_PY, "-m", "pip", "install", "--upgrade", "pip"], check=True)
        subprocess.run([VENV_PY, "-m", "pip", "install", "-r", REQS], check=True)
        with open(marker, "w") as f:
            f.write(wanted)


def npm_cmd():
    npm = shutil.which("npm")       # finds npm.cmd on Windows
    if not npm:
        fail("Node.js / npm not found. Install Node.js 18 or newer: https://nodejs.org")
    return npm


def setup_frontend():
    npm    = npm_cmd()
    marker = os.path.join(ROOT, "node_modules", ".edgewatch-lock.sha256")
    wanted = file_hash(os.path.join(ROOT, "package-lock.json"))
    if not os.path.isfile(marker) or open(marker).read().strip() != wanted:
        say("Installing dashboard packages (npm install) …")
        subprocess.run([npm, "install", "--no-audit", "--no-fund"], cwd=ROOT, check=True)
        with open(marker, "w") as f:
            f.write(wanted)


# ─── Start ────────────────────────────────────────────────────
def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))   # no packet is sent
            return s.getsockname()[0]
    except OSError:
        return None


def start(backend, frontend):
    procs = []
    if backend:
        if not os.path.isfile(os.path.join(BACKEND, ".env")):
            say("Note: backend/.env not found — using defaults. Copy backend/.env.example to backend/.env to configure.")
        procs.append(("backend", subprocess.Popen([VENV_PY, "app.py"], cwd=BACKEND)))
    if frontend:
        procs.append(("dashboard", subprocess.Popen([npm_cmd(), "run", "dev"], cwd=ROOT)))

    time.sleep(3)
    ip = lan_ip()
    if frontend:
        say("Dashboard:  http://localhost:8080" + (f"   (other PCs: http://{ip}:8080)" if ip else ""))
    if backend:
        say("Backend:    http://localhost:5005/api/health-check")
    say("Press Ctrl+C to stop.")

    try:
        while all(p.poll() is None for _, p in procs):
            time.sleep(1)
        for name, p in procs:
            if p.poll() is not None:
                say(f"{name} stopped (exit code {p.returncode}) — stopping the rest.")
    except KeyboardInterrupt:
        say("Stopping …")
    finally:
        for _, p in procs:
            if p.poll() is None:
                p.terminate()
        for _, p in procs:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()


def main():
    ap = argparse.ArgumentParser(description="Start Edge Watch (Windows / Linux / Jetson)")
    ap.add_argument("--backend", action="store_true", help="only start the backend")
    ap.add_argument("--frontend", action="store_true", help="only start the dashboard")
    ap.add_argument("--setup", action="store_true", help="only install / update dependencies")
    args = ap.parse_args()

    both     = not (args.backend or args.frontend)
    backend  = args.backend or both
    frontend = args.frontend or both

    if backend:
        setup_backend()
    if frontend:
        setup_frontend()
    if not args.setup:
        start(backend, frontend)


if __name__ == "__main__":
    main()
