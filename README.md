# 🏭 EDGEAI- Predictive Maintainance

![Version](https://img.shields.io/badge/version-1.0.0-red)
![Platform](https://img.shields.io/badge/platform-Jetson%20AGX%20Orin-green)
![Frontend](https://img.shields.io/badge/frontend-React%20+%20Vite-blue)
![Backend](https://img.shields.io/badge/backend-Flask-orange)
![Protocol](https://img.shields.io/badge/protocol-MQTT-purple)
![License](https://img.shields.io/badge/license-Proprietary-lightgrey)

---

## 🚀 AI-Powered Industrial Monitoring Platform

> Real-time machine monitoring + Predictive Maintenance dashboard  
> Built for **Industry 4.0 on Edge Devices (Jetson)**

---

## 🧠 Features

- 📡 Real-time sensor data via **MQTT**
- 📊 Live dashboards (Velocity, Acceleration, Temp, Acoustic)
- 🧠 AI Predictive Maintenance
- ⚠️ Fault Detection (Bearing fault etc.)
- 📈 Forecast graphs (Vibration, Temperature, Health)
- 💡 AI Recommendations system
- 📋 Live data table
- 📱 Fullscreen interactive charts (tap to expand)
- 🌙 Dark industrial UI theme

---

## 🏗️ System Architecture
Sensors → MQTT Broker → Flask Backend → React Frontend
↓
AI Model / Predictions

---

## ⚙️ Tech Stack

### Frontend
- React (Vite)
- TypeScript
- Tailwind CSS
- Recharts (graphs)
- ShadCN UI

### Backend
- Python
- Flask
- Paho MQTT

### Hardware
- NVIDIA Jetson (Edge AI)

---

## 📡 Data Flow

1. Sensors send data via MQTT
2. Flask subscribes to topic
3. Backend exposes API (`/api/live-data`)
4. Frontend fetches every 2 sec
5. Charts + cards update in real-time

---

## 🤖 Predictive Maintenance

Includes:

- Health Score
- Failure Risk %
- Remaining Life (days)
- AI Confidence
- Fault Detection (e.g. Bearing Fault)
- Forecast graphs
- Recommendations

⚠️ Currently:
- Uses mock AI data (fallback)
- Can be replaced with real ML model

---


---

## 🖥️ Installation — Windows and Jetson / Linux

Needs **Python 3.11+** and **Node.js 18+** (Windows: install both from python.org / nodejs.org,
tick "Add python.exe to PATH").

```bash
git clone https://github.com/vansh1031/edge-watch-1.git
cd edge-watch-1
cp backend/.env.example backend/.env     # Windows: copy backend\.env.example backend\.env
python run.py                            # Windows: py run.py   if "python" is not found
```

`run.py` creates `backend/venv`, installs the Python and npm packages (first time only, again
when they change) and starts the backend (port 5005) and the dashboard (port 8080).
Open http://localhost:8080 — from another PC use the address `run.py` prints.
`python run.py --backend` / `--frontend` starts only one part. Stop with **Ctrl+C**.

Windows: allow Python and Node.js when Windows Firewall asks, otherwise other PCs cannot
reach ports 5005 / 8080.

Every push is tested on Windows, Linux x64 and Linux ARM64 (Jetson) — see `.github/workflows/ci.yml`.

🎛️ Demo mode (for presentations)

Pick **Demo mode** in the *Mode* dropdown at the top. The Demo page runs its own simulated
machine with its own copy of the AI's memory:

- **Simulate a condition**: Healthy, Bearing fault, Misalignment, Imbalance, Overheating, Motor off.
- **Sliders** for every sensor value — health score, status, fault type, remaining life,
  alerts and recommendations react within a second.
- Your values are held for 10 s after the last change, then glide back to the simulated
  data over 8 s. **Reset** returns immediately.
- Nothing in Demo mode is stored, sent to a machine (STOP/RUN only shown as "would send")
  or visible in Normal mode. Each browser tab gets its own independent demo.

Pick **Normal mode** to return to the live dashboard.

🏭 3D machine view

Both pages show a rotatable 3D twin of the machine (motor → coupling → bearing with the
sensor → fan rotor). Drag to rotate, scroll to zoom, **Reset view** to go back.

- Velocity X / Y / Z: the machine shakes along that axis and the sensor arrows grow
  (assumed mounting: X sideways, Y up–down, Z along the shaft — confirm for your sensor).
- Acceleration: the bearing buzzes, glows and sparks. Temperature: heat fills the motor from
  the bottom (orange at warning, red at critical) with steam. Acoustic: sound rings.
- The part named by the AI fault is highlighted (bearing, coupling, rotor, motor).
- three.js is bundled (works offline). Rendering pauses when the view is off screen. Computers
  without WebGL show a short message instead; the rest of the dashboard is unaffected.

🖥️ Screen sizes

On screens 1280 px wide and larger the whole interface scales with the window (1280×720 up to
4K) — no browser zoom needed. The Demo page always fits one screen: controls and results scroll
on their own, the 3D machine stays visible. Phones and tablets get a stacked layout.

🧠 How faults are detected

- `random_forest.pkl` → severity (normal / warning / fault); `fault_type_classifier.pkl` →
  fault type (bearing fault, misalignment, imbalance).
- Rules where the models have no training data, shown as "rule-based": **overheating**
  (≥ 45 °C warning, ≥ 70 °C critical) and **high vibration** (any vibration axis past its
  ISO 10816 critical limit for 3 readings in a row).
- Physically impossible values (e.g. 19 020 mm/s) are ignored as sensor glitches.

🔌 MQTT & Safety Configuration

All settings come from environment variables or `backend/.env`:

```bash
cp backend/.env.example backend/.env   # then edit it — never commit .env
```

- **Use your own broker with TLS + password.** Defaults still point at the public
  `broker.emqx.io` so old setups keep working, but anyone can publish fake readings or
  STOP/RUN commands there. The backend prints a warning at startup while this is the case.
- **STOP** (`1` on `wired/control`) is sent on the first critical reading and re-sent every
  `SHUTDOWN_RESEND_S` while the machine stays critical.
- **RUN is never sent automatically** unless `AUTO_RESUME=true` (then only after
  `RESUME_HOLD_S` of normal status). Manual resume:
  `curl -X POST -H "X-Control-Token: $CONTROL_TOKEN" http://<jetson>:5005/api/control/resume`
- **Sensor offline:** if no real reading arrives for `EDGEWATCH_SENSOR_TIMEOUT` s, a critical
  alert is raised. With `EDGEWATCH_SIM=auto` (default) synthetic data only runs until the first
  real reading — it never replaces a sensor that went silent (`fallback` mode does, for demos).

💾 Data storage

- Real readings, alerts (with who acknowledged them) and every STOP/RUN command are stored in
  SQLite: `backend/edgewatch.db` (change with `EDGEWATCH_DB`). Simulated data is never stored.
- On first start the old `backend/sensor_data.csv` is imported once (damaged rows are skipped);
  the CSV is no longer written. Download readings as CSV from the History page (**Export CSV**)
  or `GET /api/history/export.csv?start_ms=&end_ms=`.
- Readings older than `EDGEWATCH_RETENTION_DAYS` (default 365, `0` = keep forever) are deleted hourly.
- The dashboard receives live data over one Server-Sent Events connection: `GET /api/stream`.

Run backend tests: `cd backend && python -m pytest tests`


📊 API Endpoints
| Endpoint          | Description        |
| ----------------- | ------------------ |
| `/api/live-data`  | Latest sensor data |
| `/api/prediction` | AI prediction      |
| `/api/forecast`   | Forecast data      |\

🧪 Example Sensor Data
{
  "aRMSx": 0.054,
  "aRMSy": 0.097,
  "aRMSz": 0.055,
  "vRMSx": 0.66,
  "vRMSy": 0.97,
  "vRMSz": 0.70,
  "temperature": 24.7,
  "acousticRMS": 54.8
}

⚡ Future Improvements
Real ML model integration
Anomaly detection model (Isolation Forest / LSTM)
Database (InfluxDB / PostgreSQL)
Multi-machine support
Alerts via SMS / Email
Edge optimization

👨‍💻 Developed By

Vanshraj Singh Rathore — vanshraj.rathore.05227@gmail.com

📜 License

Proprietary – Internal Use Only


---




