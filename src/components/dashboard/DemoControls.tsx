import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, RotateCcw, Hand, Undo2, Radio } from 'lucide-react';
import { DemoSessionInfo, DemoTick, SensorField } from '@/types/sensor';

interface DemoControlsProps {
  info: DemoSessionInfo;
  tick: DemoTick | null;
  onValues: (values: Partial<Record<SensorField, number>>) => void;
  onPreset: (preset: string) => void;
  onReset: () => void;
}

const LABELS: Record<SensorField, string> = {
  vRMSx: 'Velocity X', vRMSy: 'Velocity Y', vRMSz: 'Velocity Z',
  aRMSx: 'Acceleration X', aRMSy: 'Acceleration Y', aRMSz: 'Acceleration Z',
  temperature: 'Temperature', aucausticRMS: 'Acoustic',
};

const GROUPS: { title: string; fields: SensorField[] }[] = [
  { title: 'Vibration velocity', fields: ['vRMSx', 'vRMSy', 'vRMSz'] },
  { title: 'Vibration acceleration', fields: ['aRMSx', 'aRMSy', 'aRMSz'] },
  { title: 'Temperature & sound', fields: ['temperature', 'aucausticRMS'] },
];

const SEND_EVERY_MS = 150;
// Keep showing the user's own value this long after the last change, so the
// slider does not jump back before the backend has applied it (ticks are 1 s)
const SETTLE_MS = 1500;

function levelClass(info: DemoSessionInfo, field: SensorField, value: number) {
  const t = info.thresholds[field];
  if (!t) return 'text-foreground';
  if (value >= t.critical) return 'text-status-critical';
  if (value >= t.warning) return 'text-status-warning';
  return 'text-status-normal';
}

const DemoControls = ({ info, tick, onValues, onPreset, onReset }: DemoControlsProps) => {
  // While a slider is being changed, show the local value; afterwards follow the
  // backend (so the sliders visibly glide back when values return to simulated data)
  const [dragging, setDragging] = useState<Partial<Record<SensorField, number>>>({});
  const pending = useRef<Partial<Record<SensorField, number>>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const settle = useRef<Partial<Record<SensorField, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => () => {
    clearTimeout(timer.current);
    Object.values(settle.current).forEach(clearTimeout);
  }, []);

  const flush = () => {
    timer.current = undefined;
    if (Object.keys(pending.current).length) {
      onValues(pending.current);
      pending.current = {};
    }
  };

  const change = (field: SensorField, value: number) => {
    setDragging(prev => ({ ...prev, [field]: value }));
    pending.current[field] = value;
    if (!timer.current) timer.current = setTimeout(flush, SEND_EVERY_MS);

    clearTimeout(settle.current[field]);
    settle.current[field] = setTimeout(() => {
      setDragging(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }, SETTLE_MS);
  };

  const demo = tick?.demo;
  let StatusIcon = Radio;
  let status = 'Live simulated data — move a slider or pick a fault';
  let statusClass = 'text-muted-foreground';
  if (demo && demo.override > 0) {
    if (demo.returning) {
      StatusIcon = Undo2;
      status = `Returning to simulated data… ${Math.round(demo.override * 100)}% of your values left`;
      statusClass = 'status-warning';
    } else {
      StatusIcon = Hand;
      status = `Your values are held — returning to simulated data in ${Math.ceil(demo.hold_left)} s`;
      statusClass = 'text-accent';
    }
  }

  return (
    <div className="glow-card rounded-xl bg-card p-5 space-y-5">
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-foreground">What-if controls</h3>
        <button
          onClick={onReset}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>

      <p className={`flex items-center gap-1.5 text-xs ${statusClass}`} aria-live="polite">
        <StatusIcon size={13} className="shrink-0" /> {status}
      </p>

      <div>
        <p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground mb-2">Simulate a condition</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {info.presets.map(p => (
            <button
              key={p.id}
              onClick={() => onPreset(p.id)}
              className="px-2 py-2 rounded-lg text-xs font-medium border border-border text-foreground hover:border-accent hover:bg-accent/10 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {GROUPS.map(group => (
        <div key={group.title} className="space-y-3">
          <p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{group.title}</p>
          {group.fields.map(field => {
            const range = info.ranges[field];
            const live = Number(tick?.reading[field] ?? info.history.at(-1)?.[field] ?? range.min);
            const value = dragging[field] ?? live;
            const held = demo?.targets[field] !== undefined;
            const t = info.thresholds[field];
            return (
              <label key={field} className="block">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-foreground">
                    {LABELS[field]}
                    {held && <span className="ml-1.5 text-[0.5625rem] px-1 rounded bg-accent/15 text-accent align-middle">SET</span>}
                  </span>
                  <span className={`font-mono ${levelClass(info, field, value)}`}>
                    {value.toFixed(range.step < 0.1 ? 2 : 1)} {range.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={value}
                  onChange={e => change(field, Number(e.target.value))}
                  aria-label={LABELS[field]}
                  className="w-full accent-[hsl(var(--accent))] cursor-pointer"
                />
                {t && (
                  <p className="text-[0.625rem] text-muted-foreground">
                    warning ≥ {t.warning} · critical ≥ {t.critical} {range.unit}
                  </p>
                )}
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default DemoControls;
