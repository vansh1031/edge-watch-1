import { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from 'lucide-react';
import { MachineScene, MachineFault, Limits } from './machineScene';
import { FaultType, MachineStatus, SensorField } from '@/types/sensor';

interface MachineViewProps {
  reading: Partial<Record<SensorField, number>> | null;   // latest reading (8 sensor values)
  status: MachineStatus | null;                     // from the AI prediction
  faultType: FaultType | null;                      // from the AI prediction
  motorOff?: boolean;
  limits?: Limits;
  className?: string;
}

const FAULT_PART: Record<FaultType, { fault: MachineFault; label: string }> = {
  'none':           { fault: 'none',         label: 'No fault detected' },
  'bearing fault':  { fault: 'bearing',      label: 'Bearing fault — bearing housing' },
  'misalignment':   { fault: 'misalignment', label: 'Misalignment — shaft coupling' },
  'imbalance':      { fault: 'imbalance',    label: 'Imbalance — fan rotor' },
  'overheating':    { fault: 'overheating',  label: 'Overheating — motor' },
  'high vibration': { fault: 'vibration',    label: 'High vibration — sensor axes' },
};

const STATUS_STYLE = {
  normal:   { text: 'Normal',        cls: 'status-normal' },
  warning:  { text: 'Warning',       cls: 'status-warning' },
  critical: { text: 'Critical',      cls: 'status-critical' },
  off:      { text: 'Motor stopped', cls: 'text-muted-foreground' },
  none:     { text: 'No data',       cls: 'text-muted-foreground' },
};

const toolBtn = 'px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-secondary/90 backdrop-blur-sm transition-colors';

/** 3D twin of the monitored machine. Loaded lazily (three.js is large). */
const FIELDS: SensorField[] = ['aRMSx', 'aRMSy', 'aRMSz', 'vRMSx', 'vRMSy', 'vRMSz', 'temperature', 'aucausticRMS'];

const MachineView = ({ reading, status, faultType, motorOff = false, limits, className = '' }: MachineViewProps) => {
  const values = useMemo(() => {
    if (!reading || typeof reading.temperature !== 'number') return null;
    return Object.fromEntries(FIELDS.map(f => [f, Number(reading[f] ?? 0)])) as Record<string, number>;
  }, [reading]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MachineScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [labels, setLabels] = useState(true);
  const [spin, setSpin] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current, tags = tagsRef.current;
    if (!canvas || !tags) return;
    let scene: MachineScene;
    try {
      scene = new MachineScene(canvas, tags);
    } catch {
      setFailed(true);            // no WebGL on this computer — rest of the page still works
      return;
    }
    sceneRef.current = scene;
    setSpin(scene.autoRotate);
    const ro = new ResizeObserver(([e]) => scene.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(canvas.parentElement!);
    scene.start();
    return () => { ro.disconnect(); scene.dispose(); sceneRef.current = null; };
  }, []);

  const part = FAULT_PART[faultType ?? 'none'] ?? FAULT_PART.none;
  useEffect(() => {
    if (!sceneRef.current || !values) return;
    sceneRef.current.setState({ values, fault: part.fault, motorOff });
  }, [values, part.fault, motorOff]);
  useEffect(() => { if (limits) sceneRef.current?.setLimits(limits); }, [limits]);

  const st = STATUS_STYLE[!values ? 'none' : motorOff ? 'off' : status ?? 'none'];

  return (
    <section aria-label="3D machine view" className={`glow-card rounded-xl bg-card relative overflow-hidden min-h-[16rem] ${className}`}>
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-6 text-muted-foreground">
          <Box size={28} />
          <p className="text-sm">3D view is not available on this computer (WebGL is turned off or unsupported).</p>
          <p className="text-xs">All values and AI results are still shown in the cards.</p>
        </div>
      ) : (
        <>
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing touch-none"
                  aria-label="Rotatable 3D model: motor, coupling, bearing with sensor, fan rotor" />
          <div ref={tagsRef} className="absolute inset-0 pointer-events-none" />
          <div className="absolute left-3 top-3 right-3 flex flex-wrap gap-2 pointer-events-none">
            <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-card/80 border border-border backdrop-blur-sm ${st.cls}`}>
              <span className="w-2 h-2 rounded-full bg-current" />{st.text}
            </span>
            {values && !motorOff && (
              <span className="px-2.5 py-1 rounded-full text-xs bg-card/80 border border-border backdrop-blur-sm text-foreground">
                {part.label}
              </span>
            )}
          </div>
          <div className="absolute right-3 bottom-3 flex gap-2">
            <button type="button" aria-pressed={labels} onClick={() => { const next = !labels; setLabels(next); if (sceneRef.current) sceneRef.current.showLabels = next; }}
                    className={`${toolBtn} ${labels ? 'border-accent text-accent' : 'border-border text-foreground'}`}>Part names</button>
            <button type="button" aria-pressed={spin} onClick={() => { const next = !spin; setSpin(next); if (sceneRef.current) sceneRef.current.autoRotate = next; }}
                    className={`${toolBtn} ${spin ? 'border-accent text-accent' : 'border-border text-foreground'}`}>Auto-rotate</button>
            <button type="button" onClick={() => sceneRef.current?.home()} className={`${toolBtn} border-border text-foreground`}>Reset view</button>
          </div>
          <p className="absolute left-3 bottom-3.5 text-[0.6875rem] text-muted-foreground pointer-events-none hidden sm:block">Drag to rotate · scroll to zoom</p>
        </>
      )}
    </section>
  );
};

export default MachineView;
