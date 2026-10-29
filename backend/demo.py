"""
demo.py — What-if Demo mode
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Each open Demo page gets its own DemoSession:
  - its own synthetic sensor (healthy machine) as the base signal
  - its own SensorBuffer → health EMA / trend / RUL never touch the live machine
  - user values (sliders / fault presets) are blended over the base signal
  - after HOLD_S seconds without input the values glide back to the
    simulated data over GLIDE_S seconds; reset() returns immediately

Nothing here is stored, published on MQTT or pushed to the live stream.
STOP / RUN are only shown as "would send".
"""

import threading
import time
import uuid
from collections import deque

from control import ShutdownController, STOP
from predict import predict, SensorBuffer, THRESHOLDS
from synthetic import SyntheticSensor, PROFILES

HOLD_S  = 10.0    # user values held this long after the last change
GLIDE_S = 8.0     # then fade back to the simulated data over this long

FIELDS = ["aRMSx", "aRMSy", "aRMSz", "vRMSx", "vRMSy", "vRMSz", "temperature", "aucausticRMS"]

# Slider ranges (cover normal → beyond critical for every field)
RANGES = {
    **{f: {"min": 0, "max": 1.5,  "step": 0.01, "unit": "g"}    for f in ["aRMSx", "aRMSy", "aRMSz"]},
    **{f: {"min": 0, "max": 10,   "step": 0.05, "unit": "mm/s"} for f in ["vRMSx", "vRMSy", "vRMSz"]},
    "temperature":  {"min": 15, "max": 90,  "step": 0.5, "unit": "°C"},
    "aucausticRMS": {"min": 30, "max": 180, "step": 1,   "unit": "dB"},
}

PRESETS = {
    "healthy":      ("Healthy",       PROFILES["normal"]),
    "bearing":      ("Bearing fault", PROFILES["bearing"]),
    "misalignment": ("Misalignment",  PROFILES["misalignment"]),
    "imbalance":    ("Imbalance",     PROFILES["imbalance"]),
    "overheating":  ("Overheating",   PROFILES["overheating"]),
    "off":          ("Motor off",     PROFILES["off"]),
}


def _clamp(field, value):
    r = RANGES[field]
    return max(r["min"], min(r["max"], float(value)))


class DemoSession:
    def __init__(self, recommendations_for, interval_s=1.0):
        self.id          = uuid.uuid4().hex
        self.interval_s  = interval_s
        self._recs_for   = recommendations_for
        self._lock       = threading.Lock()
        self._sensor     = SyntheticSensor(interval_s=interval_s, scenario="normal")
        self._fresh_state()

    def _fresh_state(self):
        self._buffer      = SensorBuffer()
        self._targets     = {}           # field → value chosen by the user
        self._last_input  = 0.0
        self._alerts      = deque(maxlen=20)
        self._would_send  = deque(maxlen=10)
        self._controller  = ShutdownController(publish=self._would_publish)

    def _would_publish(self, payload, reason):
        self._would_send.appendleft({"command": "STOP" if payload == STOP else "RUN",
                                     "reason": reason, "timestamp": int(time.time() * 1000)})
        return True

    # ── Input ─────────────────────────────────────────────────
    def set_values(self, values: dict):
        with self._lock:
            for field, value in values.items():
                if field in RANGES:
                    self._targets[field] = _clamp(field, value)
            self._last_input = time.time()

    def set_preset(self, name: str) -> bool:
        if name not in PRESETS:
            return False
        self.set_values({f: PRESETS[name][1][f] for f in FIELDS})
        return True

    def reset(self):
        with self._lock:
            self._fresh_state()

    def resume(self):
        with self._lock:
            self._controller.resume("DEMO: operator resume")

    # ── Blend weight: 1 = user values, 0 = simulated data ─────
    def _weight(self, now):
        if not self._targets:
            return 0.0
        idle = now - self._last_input
        if idle <= HOLD_S:
            return 1.0
        if idle < HOLD_S + GLIDE_S:
            return 1.0 - (idle - HOLD_S) / GLIDE_S
        self._targets = {}               # fully back on simulated data
        return 0.0

    # ── One step (called every interval_s by the stream) ──────
    def tick(self) -> dict:
        with self._lock:
            now  = time.time()
            base = self._sensor.next()
            base.pop("scenario", None)
            w    = self._weight(now)
            reading = dict(base)
            for field, target in self._targets.items():
                reading[field] = round(base[field] + w * (target - base[field]), 6)
            reading["simulated"] = True
            reading["demo"]      = True

            pred = predict(reading, buffer=self._buffer)

            ts = reading["timestamp"]
            for a in pred.get("alerts", []):
                recent = any(x["type"] == a["type"] and x["severity"] == a["severity"]
                             and ts - x["timestamp"] < 15_000 for x in self._alerts)
                if not recent:
                    self._alerts.appendleft({**a, "id": f"demo-{a['type']}-{ts}", "timestamp": ts, "simulated": True})

            self._controller.update(pred)     # never publishes — records "would send"
            ctl = self._controller.state()

            levels = {}
            for field, (warn, crit) in THRESHOLDS.items():
                v = float(reading.get(field, 0))
                levels[field] = "critical" if v >= crit else "warning" if v >= warn else "normal"

            hold_left = max(0.0, HOLD_S - (now - self._last_input)) if self._targets else 0.0
            return {
                "reading":    {**reading, "levels": levels, "stale": False, "age_s": None},
                "prediction": {k: pred[k] for k in ("failure_risk", "rul_hours", "status", "fault_type",
                                                     "fault_source", "severity", "confidence",
                                                     "health_score", "motor_off", "trend")},
                "alerts":     list(self._alerts),
                "recommendations": self._recs_for(pred),
                "control": {
                    **ctl,
                    "would_send":     list(self._would_send),
                    "machine_status": pred["status"],
                    "motor_off":      pred["motor_off"],
                },
                "demo": {
                    "override":  round(w, 3),         # 1 = your values, 0 = simulated data
                    "hold_left": round(hold_left, 1),
                    "returning": 0 < w < 1,
                    "targets":   dict(self._targets),
                },
            }

    def warmup_history(self, n=60) -> list:
        """Healthy readings for the charts so they are not empty on open."""
        rows = self._sensor.backfill(int(n * self.interval_s))
        for r in rows:
            r.pop("scenario", None)
        return rows


class DemoRegistry:
    """Open demo sessions, one per Demo page connection."""
    def __init__(self):
        self._sessions = {}
        self._lock     = threading.Lock()

    def add(self, session):
        with self._lock:
            self._sessions[session.id] = session

    def get(self, sid):
        with self._lock:
            return self._sessions.get(sid)

    def remove(self, sid):
        with self._lock:
            self._sessions.pop(sid, None)

    def __len__(self):
        with self._lock:
            return len(self._sessions)


def session_info() -> dict:
    """Static data the Demo page needs: slider ranges, thresholds, presets."""
    return {
        "fields":     FIELDS,
        "ranges":     RANGES,
        "thresholds": {k: {"warning": w, "critical": c} for k, (w, c) in THRESHOLDS.items()},
        "presets":    [{"id": k, "label": label, "values": {f: v[f] for f in FIELDS}}
                       for k, (label, v) in PRESETS.items()],
        "hold_s":     HOLD_S,
        "glide_s":    GLIDE_S,
    }
