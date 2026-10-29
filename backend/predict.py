"""
predict.py — ML Prediction Engine with Temporal Context
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Models:
  isolation_forest.pkl  → Anomaly detection
  random_forest.pkl     → Fault classification
  scaler.pkl            → Feature normalization
  rul_params.pkl        → RUL config
  fault_map.pkl         → Label mapping

New in this version:
  ✅ SensorBuffer      — rolling window of last 30 readings
  ✅ Trend detection   — is system degrading or stable?
  ✅ Motor OFF detect  — prevent false alarms when motor is off
  ✅ EMA smoothing     — stable health_score output
  ✅ RUL decrease-only — RUL never increases randomly
  ✅ Industrial thresholds
"""

import pickle
import os
import time
import warnings
import numpy as np
from collections import deque

# On the Jetson every prediction printed this sklearn UserWarning and it
# filled backend-error.log with 7.5 GB. sklearn emits it when the process
# has no warning filters installed; installing this filter removes both the
# trigger and the message.
warnings.filterwarnings(
    "ignore",
    message=r"`sklearn\.utils\.parallel\.delayed` should be used",
    category=UserWarning,
)

# ─── Config ───────────────────────────────────────────────────
MODEL_DIR = os.path.join(os.path.dirname(__file__), "ml_models")

FEATURES = [
    'aRMSx', 'aRMSy', 'aRMSz',
    'vRMSx', 'vRMSy', 'vRMSz',
    'temperature', 'aucausticRMS'
]

FAULT_NAMES = {
    0: "none",
    1: "bearing fault",
    2: "misalignment",
    3: "imbalance",
    4: "overheating",
}

# random_forest.pkl predicts SEVERITY (train_model.py: Normal / Warning / Fault),
# fault_type_classifier.pkl predicts the fault TYPE (codes in FAULT_NAMES).
SEVERITY_NAMES = {0: "normal", 1: "warning", 2: "fault"}

# ─── Industrial Thresholds ────────────────────────────────────
# Based on ISO 10816 + domain knowledge for your sensor range
THRESHOLDS = {
    # field          warn    critical   unit
    "vRMSx":        (1.8,   4.5),    # mm/s
    "vRMSy":        (1.8,   4.5),    # mm/s
    "vRMSz":        (1.8,   4.5),    # mm/s
    "aRMSx":        (0.8,   1.5),    # g
    "aRMSy":        (0.8,   1.5),    # g
    "aRMSz":        (0.8,   1.5),    # g
    "temperature":  (45.0,  70.0),   # °C
    "aucausticRMS": (65.0,  80.0),   # dB
}

# Motor OFF detection — all vibration near zero
MOTOR_OFF_THRESHOLD = 0.05   # g / mm/s — below this = motor likely OFF

# Physically impossible values = sensor glitch (the real data has e.g. 19 020 mm/s).
# Such a reading is ignored instead of driving the model or a STOP.
PLAUSIBLE_MAX = {
    "vRMSx": 100, "vRMSy": 100, "vRMSz": 100,     # mm/s
    "aRMSx": 50,  "aRMSy": 50,  "aRMSz": 50,      # g
    "temperature": 150,                            # °C
    "aucausticRMS": 250,                           # dB
}

# The models never saw a single axis far past its limit and call it normal.
# Vibration past the critical threshold this many readings in a row → critical
# (one-off spikes don't stop the machine).
VIBRATION_FIELDS  = ["vRMSx", "vRMSy", "vRMSz", "aRMSx", "aRMSy", "aRMSz"]
CRIT_PERSIST      = 3

# EMA smoothing factor (0 = no smoothing, 1 = full smoothing)
# 0.7 means 70% previous + 30% new — very stable
EMA_ALPHA = 0.3

# Rolling window size
BUFFER_SIZE = 30

# Minimum RUL change to update (prevents micro-fluctuations)
RUL_MIN_CHANGE = 2   # hours


# ─── Load Models Once at Startup ──────────────────────────────

def _load(filename):
    path = os.path.join(MODEL_DIR, filename)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Model not found: {path}")
    with open(path, "rb") as f:
        return pickle.load(f)

try:
    _scaler    = _load("scaler.pkl")
    _iso       = _load("isolation_forest.pkl")
    _rf        = _load("random_forest.pkl")
    _rul       = _load("rul_params.pkl")
    _fault_map = _load("fault_map.pkl")
    try:
        _ft = _load("fault_type_classifier.pkl")
    except Exception as e:
        _ft = None
        print(f"[ML] ⚠️  Fault type classifier not loaded ({e}) — fault type from rules")
    # Trained with n_jobs=-1. For one reading at a time that only adds
    # thread start-up cost (~3x slower). Predict single-threaded.
    for _m in (_iso, _rf, _ft):
        if hasattr(_m, "n_jobs"):
            _m.n_jobs = 1
    MODELS_LOADED = True
    print("[ML] ✅ All models loaded successfully.")
except Exception as e:
    MODELS_LOADED = False
    print(f"[ML] ⚠️  Model load failed: {e}")
    print("[ML]    Falling back to threshold-based rules.")


# ─── Sensor Buffer (Temporal Memory) ─────────────────────────
class SensorBuffer:
    """
    Maintains a rolling window of recent sensor readings.
    Used for:
      - Trend detection (is machine degrading?)
      - Smoothed health score (EMA)
      - Motor OFF detection
      - RUL stability (decrease-only with dampening)
    """
    def __init__(self, maxlen: int = BUFFER_SIZE):
        self._buf            = deque(maxlen=maxlen)
        self._ema_health     = None   # EMA of health score
        self._last_rul       = None   # last reported RUL (for decrease-only)
        self._motor_off_count= 0      # consecutive motor-off readings
        self._vib_crit_streak= 0      # consecutive readings with vibration past critical

    def track_vibration_critical(self, is_critical: bool) -> int:
        self._vib_crit_streak = self._vib_crit_streak + 1 if is_critical else 0
        return self._vib_crit_streak

    def push(self, data: dict):
        """Add new sensor reading to buffer."""
        self._buf.append(data)

    def is_motor_off(self) -> bool:
        """
        Motor OFF = all vibration axes near zero.
        Uses last 3 readings for stability.
        """
        if len(self._buf) < 3:
            return False
        recent = list(self._buf)[-3:]
        for r in recent:
            vx = abs(float(r.get("vRMSx", 0)))
            vy = abs(float(r.get("vRMSy", 0)))
            vz = abs(float(r.get("vRMSz", 0)))
            ax = abs(float(r.get("aRMSx", 0)))
            if max(vx, vy, vz, ax) > MOTOR_OFF_THRESHOLD:
                return False
        return True

    def get_trend(self, key: str, window: int = 10) -> float:
        """
        Calculate trend slope for a sensor key over last N readings.
        Positive = increasing, Negative = decreasing.
        Returns 0.0 if not enough data.
        """
        if len(self._buf) < 4:
            return 0.0
        recent = list(self._buf)[-window:]
        vals   = []
        for r in recent:
            try:
                vals.append(float(r.get(key, 0)))
            except (TypeError, ValueError):
                vals.append(0.0)
        if len(vals) < 2:
            return 0.0
        # Simple linear slope: (last - first) / n
        return (vals[-1] - vals[0]) / max(len(vals) - 1, 1)

    def get_vibration_trend(self) -> float:
        """
        Combined vibration trend across all axes.
        Positive = increasing vibration = bad.
        """
        trends = [
            self.get_trend("vRMSx"),
            self.get_trend("vRMSy"),
            self.get_trend("vRMSz"),
            self.get_trend("aRMSx"),
            self.get_trend("aRMSy"),
        ]
        return float(np.mean(trends))

    def smooth_health(self, raw_health: float) -> float:
        """
        EMA smoothing for health score.
        Prevents sudden jumps in health display.
        """
        if self._ema_health is None:
            self._ema_health = raw_health
        else:
            # EMA: new = alpha * raw + (1-alpha) * previous
            self._ema_health = EMA_ALPHA * raw_health + (1 - EMA_ALPHA) * self._ema_health
        return round(self._ema_health, 1)

    def smooth_rul(self, raw_rul: int, is_motor_off: bool) -> int:
        """
        RUL smoothing with decrease-only logic.

        Rules:
          - Motor OFF → RUL stays stable (small decrease allowed)
          - Degrading trend → RUL decreases faster
          - Improving signal → RUL can only increase very slowly (max +5h)
          - Min change threshold = RUL_MIN_CHANGE hours
        """
        if self._last_rul is None:
            self._last_rul = raw_rul
            return raw_rul

        prev = self._last_rul

        if is_motor_off:
            # Motor off — very slow decay (1 hour per cycle max)
            new_rul = max(raw_rul, prev - 1)
        else:
            trend = self.get_vibration_trend()
            if trend > 0.05:
                # Degrading — allow faster drop, no increase
                new_rul = min(raw_rul, prev)
            else:
                # Stable or improving — allow tiny increase (max +5h)
                new_rul = min(raw_rul, prev + 5)

        # Apply minimum change threshold — ignore micro-fluctuations
        if abs(new_rul - prev) < RUL_MIN_CHANGE:
            new_rul = prev

        self._last_rul = new_rul
        return int(new_rul)

    @property
    def size(self) -> int:
        return len(self._buf)


# Global buffer instance (shared across all predictions)
_buffer = SensorBuffer(maxlen=BUFFER_SIZE)


# ─── Threshold Alert Builder ──────────────────────────────────

def check_thresholds(data: dict) -> list[dict]:
    """
    Check sensor values against industrial thresholds.
    Returns list of alert dicts with type, message, severity, timestamp.
    """
    alerts = []
    ts     = int(time.time() * 1000)

    for field, (warn_val, crit_val) in THRESHOLDS.items():
        try:
            val = float(data.get(field, 0))
        except (TypeError, ValueError):
            continue

        if val >= crit_val:
            alerts.append({
                "type":      field,
                "message":   f"{field} is CRITICAL: {val:.3f} (threshold: {crit_val})",
                "severity":  "critical",
                "timestamp": ts,
            })
        elif val >= warn_val:
            alerts.append({
                "type":      field,
                "message":   f"{field} is HIGH: {val:.3f} (threshold: {warn_val})",
                "severity":  "warning",
                "timestamp": ts,
            })

    return alerts


# ─── Feature Extraction ───────────────────────────────────────

def extract_features(data: dict) -> np.ndarray:
    vec = []
    for feat in FEATURES:
        try:
            vec.append(float(data.get(feat, 0)))
        except (TypeError, ValueError):
            vec.append(0.0)
    return np.array(vec).reshape(1, -1)


# ─── RUL Estimation ───────────────────────────────────────────

def _estimate_rul_raw(health_score: float) -> int:
    """
    Non-linear RUL from health score.
    Uses max_rul_hours from rul_params.pkl.
    Quadratic decay: RUL = max_rul * (health/100)^2
    """
    try:
        max_rul = float(_rul.get("max_rul_hours", 720))
    except Exception:
        max_rul = 720.0

    min_rul = 20   # minimum buffer even at worst health
    rul     = max_rul * ((health_score / 100) ** 2)
    return int(max(min_rul, min(rul, max_rul)))


# ─── Main Predict ─────────────────────────────────────────────

def predict(data: dict, buffer: "SensorBuffer | None" = None) -> dict:
    """
    Full ML prediction pipeline WITH temporal context.

    Steps:
      1. Push data to rolling buffer
      2. Detect motor OFF state
      3. Run Isolation Forest (anomaly)
      4. Run Random Forest (fault type)
      5. Calculate raw health score
      6. Apply EMA smoothing to health
      7. Estimate raw RUL
      8. Apply RUL smoothing (decrease-only)
      9. Adjust for trend (degrading = faster RUL drop)
      10. Build threshold alerts
      11. Return full prediction dict

    Returns:
      failure_risk, rul_hours, status, fault_type,
      confidence, anomaly, health_score, alerts, motor_off, trend
    """

    # ── 0. Push to temporal buffer ─────────────────────────────
    # Demo sessions pass their own buffer so they never disturb the live one
    buf = buffer if buffer is not None else _buffer

    glitches = [f for f, mx in PLAUSIBLE_MAX.items() if not 0 <= _num(data, f) <= mx]
    if glitches:
        return _glitch_result(data, glitches, buf)

    buf.push(data)
    is_motor_off = buf.is_motor_off()

    if not MODELS_LOADED:
        return _fallback_predict(data, is_motor_off, buf)

    try:
        X_raw    = extract_features(data)
        X_scaled = _scaler.transform(X_raw)

        # ── 1. Isolation Forest ────────────────────────────────
        iso_score        = _iso.decision_function(X_scaled)[0]
        iso_pred         = _iso.predict(X_scaled)[0]
        is_anomaly       = bool(iso_pred == -1)
        # Normalize: more negative iso_score = more anomalous
        anomaly_severity = float(np.clip(((-iso_score) + 0.2) / 0.4, 0, 1) * 100)

        # ── 2. Random Forest → severity (0 normal, 1 warning, 2 fault) ──
        rf_probs      = _rf.predict_proba(X_scaled)[0]
        severity      = int(_rf.predict(X_scaled)[0])
        rf_confidence = float(rf_probs.max())

        # ── 2b. Fault type: only when the severity model sees a problem ──
        fault_type, fault_source, fault_conf = "none", None, rf_confidence
        if severity > 0:
            if _ft is not None:
                ft_probs     = _ft.predict_proba(X_scaled)[0]
                fault_type   = FAULT_NAMES.get(int(_ft.classes_[ft_probs.argmax()]), "none")
                fault_conf   = float(ft_probs.max())
                fault_source = "ml"
            else:
                fault_type, fault_source = _rule_fault_type(data), "rule"

        # Overheating: in the labelling rules but never in the training data,
        # so no model can output it → threshold rule, marked as rule-based.
        temp_warn, temp_crit = THRESHOLDS["temperature"]
        temperature = float(data.get("temperature", 0) or 0)
        if temperature >= temp_warn and not is_motor_off:
            fault_type, fault_source, fault_conf = "overheating", "rule", 1.0
            severity = max(severity, 2 if temperature >= temp_crit else 1)

        # Sustained vibration past ISO 10816 critical → critical even if the model says normal
        vib_critical = any(_num(data, f) >= THRESHOLDS[f][1] for f in VIBRATION_FIELDS)
        streak = buf.track_vibration_critical(vib_critical and not is_motor_off)
        if streak >= CRIT_PERSIST and severity < 2:
            severity = 2
            if fault_type == "none":
                fault_type, fault_source, fault_conf = "high vibration", "rule", 1.0

        # Any sensor past its warning threshold → at least "warning" (no STOP)
        threshold_warning = not is_motor_off and any(
            _num(data, f) >= warn for f, (warn, _crit) in THRESHOLDS.items())

        # ── 3. Raw health score ────────────────────────────────
        # prob_normal = rf_probs[0] (index 0 = label "none")
        prob_normal  = float(rf_probs[0]) if len(rf_probs) > 0 else 1.0
        fault_weight = 1.0 - prob_normal   # how much fault probability

        raw_health = float(np.clip(
            100
            - (anomaly_severity * 0.4)   # anomaly contribution
            - (fault_weight    * 45),    # fault probability contribution
            5, 100
        ))

        # Rule-based faults (overheating, high vibration): the models don't see
        # them, so cap health to match the status
        if fault_source == "rule" and fault_type != "none":
            raw_health = min(raw_health, 40.0 if severity == 2 else 70.0)

        # Motor OFF → health stays high (not a failure condition)
        if is_motor_off:
            raw_health = max(raw_health, 80.0)

        # ── 4. EMA smoothed health ─────────────────────────────
        health_score = buf.smooth_health(raw_health)

        # ── 5. Trend adjustment ────────────────────────────────
        trend = buf.get_vibration_trend()
        # If strongly degrading, penalize health slightly more
        if trend > 0.1 and not is_motor_off:
            health_score = max(health_score - (trend * 5), 5.0)
            health_score = round(health_score, 1)

        # ── 6. Raw RUL + smoothed RUL ─────────────────────────
        raw_rul      = _estimate_rul_raw(health_score)
        rul_hours    = buf.smooth_rul(raw_rul, is_motor_off)

        # ── 7. Status ──────────────────────────────────────────
        # (Before: severity 1 "warning" was read as "bearing fault" and
        #  made the machine critical → STOP on a mere warning.)
        if is_motor_off:
            status = "normal"
        elif severity == 2 or health_score < 50:
            status = "critical"
        elif severity == 1 or health_score < 75 or is_anomaly or threshold_warning:
            status = "warning"
        else:
            status = "normal"

        failure_risk = round(100 - health_score, 1)

        # ── 8. Threshold alerts ────────────────────────────────
        alerts = [] if is_motor_off else check_thresholds(data)

        return {
            "failure_risk": failure_risk,
            "rul_hours":    rul_hours,
            "status":       status,
            "fault_type":   fault_type,
            "fault_source": fault_source,             # "ml" | "rule" | None
            "severity":     SEVERITY_NAMES.get(severity, "normal"),
            "confidence":   round(fault_conf if fault_type != "none" else rf_confidence, 2),
            "anomaly":      is_anomaly,
            "health_score": health_score,
            "alerts":       alerts,
            "motor_off":    is_motor_off,
            "trend":        round(trend, 4),
        }

    except Exception as e:
        print(f"[ML] Prediction error: {e} — using fallback")
        return _fallback_predict(data, is_motor_off, buf)


def _num(data: dict, key: str) -> float:
    try:
        return float(data.get(key, 0))
    except (TypeError, ValueError):
        return 0.0


def _glitch_result(data: dict, fields: list, buf: "SensorBuffer") -> dict:
    """Reading with impossible values: ignored, last known state kept, warning raised."""
    health = buf._ema_health if buf._ema_health is not None else 100.0
    shown  = ", ".join(f"{f}={data.get(f)}" for f in fields)
    return {
        "failure_risk": round(100 - health, 1),
        "rul_hours":    buf._last_rul if buf._last_rul is not None else 720,
        "status":       "warning",
        "fault_type":   "none",
        "fault_source": None,
        "severity":     "warning",
        "confidence":   0.0,
        "anomaly":      False,
        "health_score": round(health, 1),
        "alerts":       [{
            "type":      "sensor_glitch",
            "message":   f"Implausible sensor value ({shown}) — reading ignored, check the sensor",
            "severity":  "warning",
            "timestamp": int(time.time() * 1000),
        }],
        "motor_off":    False,
        "trend":        round(buf.get_vibration_trend(), 4),
    }


def _rule_fault_type(data: dict) -> str:
    """Same rules lable_data.py used to label the training data."""
    def sf(key):
        try: return float(data.get(key, 0))
        except (TypeError, ValueError): return 0.0
    amax = max(sf("aRMSx"), sf("aRMSy"), sf("aRMSz"))
    vmax = max(sf("vRMSx"), sf("vRMSy"), sf("vRMSz"))
    if amax > 1.0 and vmax < 4.0:
        return "bearing fault"
    if sf("vRMSx") > 3.0 and sf("vRMSy") > 3.0:
        return "misalignment"
    if vmax > 4.0 and sf("aucausticRMS") > 60:
        return "imbalance"
    if sf("temperature") > 50:
        return "overheating"
    return "bearing fault"


# ─── Fallback (no models) ─────────────────────────────────────

def _fallback_predict(data: dict, is_motor_off: bool = False, buf: "SensorBuffer | None" = None) -> dict:
    """Threshold-based fallback when models not loaded."""
    def sf(key):
        try: return float(data.get(key, 0))
        except: return 0.0

    health = 100.0
    faults = []

    if sf("aRMSx") > 1.5 or sf("aRMSy") > 1.5: health -= 20; faults.append("bearing fault")
    if sf("vRMSy") > 5.0:                        health -= 15; faults.append("misalignment")
    if sf("temperature") > 70:                   health -= 25; faults.append("overheating")
    if sf("aucausticRMS") > 80:                  health -= 10; faults.append("imbalance")

    if is_motor_off:
        health = max(health, 80.0)

    buf          = buf if buf is not None else _buffer
    health       = float(max(health, 0))
    smoothed     = buf.smooth_health(health)
    raw_rul      = int((smoothed / 100) ** 2 * 720)
    rul_hours    = buf.smooth_rul(raw_rul, is_motor_off)
    failure_risk = round(100 - smoothed, 1)
    confidence   = round(min(0.5 + failure_risk / 200, 0.99), 2)
    status       = "critical" if smoothed < 50 else "warning" if smoothed < 75 else "normal"
    alerts       = [] if is_motor_off else check_thresholds(data)

    return {
        "failure_risk": failure_risk,
        "rul_hours":    rul_hours,
        "status":       status,
        "fault_type":   faults[0] if faults else "none",
        "confidence":   confidence,
        "anomaly":      len(faults) > 0,
        "health_score": smoothed,
        "alerts":       alerts,
        "motor_off":    is_motor_off,
        "trend":        round(buf.get_vibration_trend(), 4),
        "fault_source": "rule" if faults else None,
        "severity":     "fault" if status == "critical" else "warning" if status == "warning" else "normal",
    }


# ─── Anomaly helper (for /api/anomaly route) ──────────────────

def predict_anomaly(data: dict) -> dict:
    """Lightweight wrapper — uses cached buffer state."""
    result = predict(data)
    alerts = result.get("alerts", [])

    # Add ML fault alert if detected
    if result["fault_type"] != "none" and not result["motor_off"]:
        alerts = [{
            "type":      result["fault_type"],
            "message":   f"ML: {result['fault_type'].title()} detected ({result['confidence']*100:.0f}% confidence)",
            "severity":  result["status"],
            "timestamp": int(time.time() * 1000),
        }] + alerts
    elif result["anomaly"] and result["fault_type"] == "none":
        alerts = [{
            "type":      "anomaly",
            "message":   "Isolation Forest: Anomalous pattern detected",
            "severity":  "warning",
            "timestamp": int(time.time() * 1000),
        }] + alerts

    return {
        "anomaly":     result["anomaly"],
        "status":      result["status"],
        "healthScore": result["health_score"],
        "alerts":      alerts,
    }


# ─── Quick Test ───────────────────────────────────────────────
if __name__ == "__main__":
    normal = {
        "aRMSx": 0.057, "aRMSy": 0.104, "aRMSz": 0.051,
        "vRMSx": 0.625, "vRMSy": 1.149, "vRMSz": 0.784,
        "temperature": 27.7, "aucausticRMS": 52.5,
    }
    fault = {
        "aRMSx": 2.1,  "aRMSy": 1.8,  "aRMSz": 0.9,
        "vRMSx": 6.2,  "vRMSy": 7.1,  "vRMSz": 5.8,
        "temperature": 45.0, "aucausticRMS": 75.0,
    }
    motor_off = {
        "aRMSx": 0.01, "aRMSy": 0.01, "aRMSz": 0.01,
        "vRMSx": 0.02, "vRMSy": 0.01, "vRMSz": 0.01,
        "temperature": 24.0, "aucausticRMS": 30.0,
    }

    print("\n── Normal (5 readings to warm up buffer) ──")
    for _ in range(5):
        r = predict(normal)
    print(f"  health={r['health_score']} | rul={r['rul_hours']}h | fault={r['fault_type']} | motor_off={r['motor_off']}")

    print("\n── Fault Reading ──")
    r = predict(fault)
    print(f"  health={r['health_score']} | rul={r['rul_hours']}h | fault={r['fault_type']} | trend={r['trend']}")

    print("\n── Motor OFF ──")
    for _ in range(3):
        r = predict(motor_off)
    print(f"  health={r['health_score']} | rul={r['rul_hours']}h | motor_off={r['motor_off']}")

    print("\n── RUL Decrease-only test ──")
    prev_rul = None
    for i in range(5):
        r = predict(fault)
        if prev_rul is not None:
            direction = "↓" if r['rul_hours'] <= prev_rul else "↑ (allowed: small)"
            print(f"  Step {i+1}: RUL={r['rul_hours']}h {direction}")
        prev_rul = r['rul_hours']