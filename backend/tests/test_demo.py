import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import demo
import predict
from demo import DemoSession, HOLD_S, GLIDE_S


class FakeTime:
    def __init__(self):
        self.t = 1_800_000_000.0

    def time(self):
        return self.t


def make_session(monkeypatch):
    clock = FakeTime()
    monkeypatch.setattr(demo, "time", types.SimpleNamespace(time=clock.time))
    return DemoSession(lambda pred: [{"id": "r", "message": pred["status"]}]), clock


def run(session, clock, n, step=1.0):
    out = None
    for _ in range(n):
        clock.t += step
        out = session.tick()
    return out


def test_demo_never_touches_live_model_state(monkeypatch):
    live = predict._buffer
    for _ in range(5):
        predict.predict({"aRMSx": 0.055, "aRMSy": 0.107, "aRMSz": 0.052, "vRMSx": 0.56, "vRMSy": 1.13,
                         "vRMSz": 0.56, "temperature": 27.2, "aucausticRMS": 49})
    before = (live.size, live._ema_health, live._last_rul)

    s, clock = make_session(monkeypatch)
    s.set_preset("misalignment")
    out = run(s, clock, 8)
    assert out["prediction"]["status"] == "critical"
    assert (live.size, live._ema_health, live._last_rul) == before


def test_presets_give_the_named_fault(monkeypatch):
    expected = {"bearing": "bearing fault", "misalignment": "misalignment",
                "imbalance": "imbalance", "overheating": "overheating", "healthy": "none"}
    for preset, fault in expected.items():
        s, clock = make_session(monkeypatch)
        s.set_preset(preset)
        out = run(s, clock, 6)
        assert out["prediction"]["fault_type"] == fault, preset


def test_values_hold_then_glide_back(monkeypatch):
    s, clock = make_session(monkeypatch)
    s.set_values({"temperature": 80})
    out = run(s, clock, 3)
    assert out["demo"]["override"] == 1.0 and out["reading"]["temperature"] == 80
    out = run(s, clock, int(HOLD_S))                     # past the hold time → gliding back
    assert 0 < out["demo"]["override"] < 1 and out["demo"]["returning"]
    assert 27 < out["reading"]["temperature"] < 80
    out = run(s, clock, int(GLIDE_S) + 1)                # back on simulated data
    assert out["demo"]["override"] == 0 and out["demo"]["targets"] == {}
    assert out["reading"]["temperature"] < 35


def test_reset_is_immediate_and_clears_state(monkeypatch):
    s, clock = make_session(monkeypatch)
    s.set_preset("bearing")
    out = run(s, clock, 6)
    assert out["control"]["holding_stop"] and out["control"]["would_send"][0]["command"] == "STOP"
    s.reset()
    out = run(s, clock, 1)
    assert out["demo"]["override"] == 0
    assert not out["control"]["holding_stop"] and out["alerts"] == []
    assert out["prediction"]["status"] == "normal"


def test_values_are_clamped_and_unknown_fields_ignored(monkeypatch):
    s, clock = make_session(monkeypatch)
    s.set_values({"temperature": 500, "rpm": 3000})
    out = run(s, clock, 1)
    assert out["reading"]["temperature"] == 90 and "rpm" not in out["demo"]["targets"]
