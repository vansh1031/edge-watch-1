"""
synthetic.py — Built-in synthetic sensor for Edge Watch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generates readings in the same format as the real wired RMS sensor so the
whole pipeline (ML → API → dashboard) works without hardware.

The generator walks through a repeating demo scenario (~24 min):
  normal → imbalance developing → misalignment fault → maintenance stop
  → normal → overheating drift → back to normal

Signals are built from:
  - a base profile blended between "normal" and fault profiles
  - slow load variation (sinusoid) + correlated drift (AR(1)) + white noise
  - thermal inertia on temperature
  - occasional acoustic transients

Profile medians are taken from sensor_data_labeled.csv.
"""

import math
import random
import time

# Fault profiles = medians of each class in sensor_data_labeled.csv, so the
# simulator, the demo presets and the trained models agree on the fault name.
PROFILES = {
    "normal":       {"aRMSx": 0.055, "aRMSy": 0.107, "aRMSz": 0.052, "vRMSx": 0.56,  "vRMSy": 1.13,  "vRMSz": 0.56, "temperature": 27.2, "aucausticRMS": 49,  "extra": 52},
    "bearing":      {"aRMSx": 0.63,  "aRMSy": 0.356, "aRMSz": 0.586, "vRMSx": 2.03,  "vRMSy": 1.72,  "vRMSz": 2.61, "temperature": 29.7, "aucausticRMS": 147, "extra": 150},
    "misalignment": {"aRMSx": 0.985, "aRMSy": 0.964, "aRMSz": 0.921, "vRMSx": 6.5,   "vRMSy": 8.67,  "vRMSz": 5.22, "temperature": 30.4, "aucausticRMS": 148, "extra": 150},
    "imbalance":    {"aRMSx": 0.732, "aRMSy": 0.475, "aRMSz": 0.793, "vRMSx": 2.01,  "vRMSy": 3.23,  "vRMSz": 4.87, "temperature": 31.0, "aucausticRMS": 144, "extra": 150},
    "overheating":  {"aRMSx": 0.06,  "aRMSy": 0.11,  "aRMSz": 0.055, "vRMSx": 0.6,   "vRMSy": 1.2,   "vRMSz": 0.6,  "temperature": 75,   "aucausticRMS": 52,  "extra": 55},
    "off":          {"aRMSx": 0.01,  "aRMSy": 0.01,  "aRMSz": 0.01,  "vRMSx": 0.02,  "vRMSy": 0.02,  "vRMSz": 0.02, "temperature": 25,   "aucausticRMS": 34,  "extra": 44},
}
VIB_KEYS = ["aRMSx", "aRMSy", "aRMSz", "vRMSx", "vRMSy", "vRMSz"]
ALL_KEYS = VIB_KEYS + ["temperature", "aucausticRMS", "extra"]

# (label, steps, start_weights, end_weights)
# Weights blend fault profiles on top of "normal": base = normal + Σ w·(fault − normal)
# The models only name a fault near full strength (in between they say
# "bearing fault", like the labelling rules' default), so each fault rises
# slowly to a warning, then steps quickly to the full fault and holds.
SCENARIO = [
    ("Normal operation",         150, {},                       {}),
    ("Vibration rising",          60, {},                       {"imbalance": 0.15}),
    ("Imbalance fault",           15, {"imbalance": 0.15},      {"imbalance": 1.0}),
    ("Imbalance fault",           30, {"imbalance": 1.0},       {"imbalance": 1.0}),
    ("Maintenance stop",          30, {"off": 1.0},             {"off": 1.0}),
    ("Normal operation",         120, {},                       {}),
    ("Vibration rising",          60, {},                       {"misalignment": 0.05}),
    ("Misalignment fault",        15, {"misalignment": 0.05},   {"misalignment": 1.0}),
    ("Misalignment fault",        30, {"misalignment": 1.0},    {"misalignment": 1.0}),
    ("Maintenance stop",          30, {"off": 1.0},             {"off": 1.0}),
    ("Normal operation",         120, {},                       {}),
    ("Overheating drift",         90, {},                       {"overheating": 0.5}),
    ("Overheating drift",         30, {"overheating": 0.5},     {"overheating": 0.5}),
    ("Cooling down",              60, {"overheating": 0.5},     {}),
]
SCENARIO_STEPS = sum(p[1] for p in SCENARIO)

MAC = "SIM:00:00:00:00:01"


def _smoothstep(t: float) -> float:
    return t * t * (3 - 2 * t)


def _blend(weights: dict) -> dict:
    normal = PROFILES["normal"]
    out = dict(normal)
    for fault, w in weights.items():
        for k in ALL_KEYS:
            out[k] += w * (PROFILES[fault][k] - normal[k])
    return out


def _lerp_weights(a: dict, b: dict, t: float) -> dict:
    keys = set(a) | set(b)
    return {k: a.get(k, 0.0) + (b.get(k, 0.0) - a.get(k, 0.0)) * t for k in keys}


class SyntheticSensor:
    def __init__(self, interval_s: float = 2.0, scenario: str = "demo"):
        self.interval_s = interval_s
        self.scenario   = scenario          # "demo" (cycle) or "normal"
        self.step       = 0
        self.seq        = 0
        self._temp      = PROFILES["normal"]["temperature"]
        self._drift     = {k: 0.0 for k in ALL_KEYS}

    # ── Scenario position ─────────────────────────────────────
    def phase(self, step: int | None = None):
        """Return (label, weights) for the given scenario step."""
        if self.scenario == "normal":
            return "Normal operation", {}
        s = (self.step if step is None else step) % SCENARIO_STEPS
        for label, steps, w0, w1 in SCENARIO:
            if s < steps:
                return label, _lerp_weights(w0, w1, _smoothstep(s / max(steps - 1, 1)))
            s -= steps
        return "Normal operation", {}

    # ── Signal generation ─────────────────────────────────────
    def _reading(self, ts_ms: int, weights: dict) -> dict:
        base   = _blend(weights)
        t      = ts_ms / 1000.0
        load   = 1 + 0.04 * math.sin(2 * math.pi * t / 90) + 0.02 * math.sin(2 * math.pi * t / 23)
        motor_off = weights.get("off", 0) > 0.5

        reading = {}
        for k in VIB_KEYS + ["aucausticRMS", "extra"]:
            # AR(1) drift gives the slow wander real sensors have
            self._drift[k] = 0.92 * self._drift[k] + 0.02 * random.gauss(0, 1)
            noise = 1 + self._drift[k] + 0.03 * random.gauss(0, 1)
            val   = base[k] * noise * (1 if motor_off else load)
            reading[k] = round(max(val, 0.0), 6)

        # Occasional acoustic transient (impact / valve click)
        if not motor_off and random.random() < 0.02:
            reading["aucausticRMS"] = round(reading["aucausticRMS"] * random.uniform(1.08, 1.18), 6)

        # Temperature: thermal inertia toward target, slight load dependence
        target      = base["temperature"] + (0 if motor_off else 0.6 * (load - 1) * 10)
        self._temp += (target - self._temp) * 0.05 + 0.04 * random.gauss(0, 1)
        reading["temperature"] = round(self._temp, 5)

        self.seq += 1
        return {
            "timestamp": ts_ms,
            "seq":       self.seq,
            "key":       "RMS",
            **reading,
            "mac":       MAC,
            "simulated": True,
        }

    def next(self) -> dict:
        """Generate the next live reading (timestamp = now)."""
        label, weights = self.phase()
        r = self._reading(int(time.time() * 1000), weights)
        r["scenario"] = label
        self.step += 1
        return r

    def backfill(self, seconds: int) -> list[dict]:
        """Generate `seconds` of past normal-operation history ending now."""
        n      = int(seconds / self.interval_s)
        now_ms = int(time.time() * 1000)
        rows   = []
        for i in range(n, 0, -1):
            r = self._reading(now_ms - int(i * self.interval_s * 1000), {})
            r["scenario"] = "Normal operation"
            rows.append(r)
        return rows
