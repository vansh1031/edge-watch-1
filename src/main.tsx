import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setSplashText, startSplashTimeout } from "./lib/splash";

setSplashText("Connecting to sensors…");
startSplashTimeout();

createRoot(document.getElementById("root")!).render(<App />);
