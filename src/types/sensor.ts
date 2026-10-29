// ─── Sensor Data ──────────────────────────────────────────────
export interface SensorData {
  timestamp:    number;
  seq?:         number;
  key?:         string;
  aRMSx:        number;
  aRMSy:        number;
  aRMSz:        number;
  vRMSx:        number;
  vRMSy:        number;
  vRMSz:        number;
  temperature:  number;
  aucausticRMS: number;
  acousticRMS?: number;
  mac?:         string;
  extra?:       string;
}

// ─── Status ───────────────────────────────────────────────────
export type MachineStatus = 'normal' | 'warning' | 'critical';

// ─── Data freshness (sent by backend with live data + prediction) ──
export interface DataFreshness {
  simulated: boolean;        // reading comes from the built-in synthetic sensor
  stale:     boolean;        // real sensor silent longer than EDGEWATCH_SENSOR_TIMEOUT
  age_s:     number | null;  // seconds since last real reading
}

// ─── Live reading (/api/live-data) ────────────────────────────
export interface LiveData extends SensorData, DataFreshness {
  levels: Partial<Record<keyof SensorData, MachineStatus>>;  // backend thresholds per field
}

// ─── Stream heartbeat (/api/stream "status" event) ─────────────
export interface StreamStatus extends Partial<DataFreshness> {
  has_data: boolean;
  control:  ControlStatus;
}

// ─── Machine control (/api/control/status) ────────────────────
export interface ControlStatus {
  enabled:        boolean;
  auto_resume:    boolean;
  manual_resume:  boolean;          // CONTROL_TOKEN configured on the backend
  holding_stop:   boolean;          // last command sent was STOP
  last_cmd:       'STOP' | 'RUN' | null;
  last_cmd_ts:    number | null;
  last_reason:    string | null;
  mqtt_connected: boolean;
  machine_status: MachineStatus | null;
  motor_off:      boolean | null;
}

// ─── Alerts ───────────────────────────────────────────────────
export interface Alert {
  id:           string;
  type?:        string;
  message:      string;
  severity:     MachineStatus;
  timestamp:    Date;
  simulated?:   boolean;       // raised by demo data
  acknowledged?: boolean;
  ack_by?:      string | null;
  ack_ts?:      number | null;
}

// Alert as the backend sends it (/api/alerts, stream "alert" event)
export interface RawAlert {
  id: number | string;
  type?: string;
  message?: string;
  severity?: string;
  timestamp: number;
  simulated?: boolean;
  acknowledged?: boolean;
  ack_by?: string | null;
  ack_ts?: number | null;
}

// ─── Thresholds (/api/thresholds) ─────────────────────────────
export type Thresholds = Partial<Record<keyof SensorData, { warning: number; critical: number }>>;

// ─── Anomaly ──────────────────────────────────────────────────
export interface AnomalyResponse {
  anomaly:     boolean;
  status:      MachineStatus;
  healthScore: number;
  alerts:      Alert[];
}

// ─── Fault Types ──────────────────────────────────────────────
export type FaultType = 'bearing fault' | 'misalignment' | 'imbalance' | 'overheating' | 'high vibration' | 'none';

// ─── Prediction (FINAL FIXED) ─────────────────────────────────
export interface PredictionData extends Partial<DataFreshness> {
  failure_risk: number;   // %
  rul_hours: number;      // hours
  status: MachineStatus;
  fault_type: FaultType;
  confidence: number;     // 0–1

  // ✅ MAIN FIELD (important)
  health_score: number;   // 0–100
  motor_off?: boolean;
  fault_source?: 'ml' | 'rule' | null;   // rule = threshold rule, not the trained model
  severity?: 'normal' | 'warning' | 'fault';
}

// ─── Forecast ─────────────────────────────────────────────────
export interface ForecastPoint {
  timestamp: number;
  value:     number;
  predicted: boolean;
}

export interface ForecastData {
  vRMSy:       ForecastPoint[];
  temperature: ForecastPoint[];
  healthScore: ForecastPoint[];
}

// ─── Recommendations ──────────────────────────────────────────
export interface Recommendation {
  id:       string;
  message:  string;
  priority: 'high' | 'medium' | 'low';
  category: 'maintenance' | 'risk' | 'optimization';
}
// ─── Demo mode (/api/demo/stream) ─────────────────────────────
export type SensorField = 'aRMSx' | 'aRMSy' | 'aRMSz' | 'vRMSx' | 'vRMSy' | 'vRMSz' | 'temperature' | 'aucausticRMS';

export interface DemoSessionInfo {
  id:         string;
  fields:     SensorField[];
  ranges:     Record<SensorField, { min: number; max: number; step: number; unit: string }>;
  thresholds: Thresholds;
  presets:    { id: string; label: string; values: Record<SensorField, number> }[];
  hold_s:     number;
  glide_s:    number;
  history:    SensorData[];
}

export interface DemoTick {
  reading:         LiveData;
  prediction:      PredictionData;
  alerts:          RawAlert[];
  recommendations: Recommendation[];
  control:         Omit<ControlStatus, 'manual_resume' | 'mqtt_connected'> & {
    would_send: { command: 'STOP' | 'RUN'; reason: string; timestamp: number }[];
  };
  demo: {
    override:  number;     // 1 = your values, 0 = simulated data
    hold_left: number;     // seconds before values start returning
    returning: boolean;
    targets:   Partial<Record<SensorField, number>>;
  };
}
