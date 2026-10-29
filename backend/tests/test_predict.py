import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import predict as P
from synthetic import PROFILES

NORMAL = {k: v for k, v in PROFILES["normal"].items() if k != "extra"}


def run(reading, n=8):
    buf = P.SensorBuffer()
    return [P.predict(reading, buffer=buf) for _ in range(n)]


def test_fault_types_from_the_right_model():
    # random_forest.pkl = severity, fault_type_classifier.pkl = type
    assert run(NORMAL)[-1]["fault_type"] == "none"
    for profile, name in [("bearing", "bearing fault"), ("misalignment", "misalignment"), ("imbalance", "imbalance")]:
        r = run(PROFILES[profile])[-1]
        assert r["fault_type"] == name and r["fault_source"] == "ml" and r["status"] == "critical"


def test_overheating_rule():
    assert run({**NORMAL, "temperature": 50})[-1]["status"] == "warning"
    r = run({**NORMAL, "temperature": 75})[-1]
    assert r["status"] == "critical" and r["fault_type"] == "overheating" and r["fault_source"] == "rule"
    assert r["health_score"] <= 50


def test_sustained_vibration_past_limit_is_critical_single_spike_is_not():
    statuses = [r["status"] for r in run({**NORMAL, "vRMSy": 7.1}, 5)]
    assert statuses[:2] == ["warning", "warning"] and statuses[2:] == ["critical"] * 3
    r = run({**NORMAL, "vRMSy": 7.1}, 5)[-1]
    assert r["fault_type"] == "high vibration" and r["fault_source"] == "rule"
    buf = P.SensorBuffer()
    for reading in [NORMAL, {**NORMAL, "vRMSy": 7.1}, NORMAL, {**NORMAL, "vRMSy": 7.1}, NORMAL]:
        assert P.predict(reading, buffer=buf)["status"] != "critical"


def test_loud_sound_alone_is_only_a_warning():
    assert {r["status"] for r in run({**NORMAL, "aucausticRMS": 150})} == {"warning"}


def test_impossible_values_are_ignored():
    buf = P.SensorBuffer()
    for _ in range(4):
        P.predict(NORMAL, buffer=buf)
    r = P.predict({**NORMAL, "vRMSy": 19020.56}, buffer=buf)
    assert r["status"] == "warning" and r["alerts"][0]["type"] == "sensor_glitch"
    assert buf.size == 4                       # glitch not fed into the model memory


def test_motor_off_is_normal():
    off = {k: v for k, v in PROFILES["off"].items() if k != "extra"}
    assert run(off)[-1]["status"] == "normal"
