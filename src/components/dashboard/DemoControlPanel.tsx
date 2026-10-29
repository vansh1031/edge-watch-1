import { Power, OctagonX, PlayCircle } from 'lucide-react';
import { DemoTick } from '@/types/sensor';

interface DemoControlPanelProps {
  control: DemoTick['control'] | null;
  onResume: () => void;
}

const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour12: false });

// Same rules as the real machine control, but nothing is ever sent.
const DemoControlPanel = ({ control, onResume }: DemoControlPanelProps) => {
  const holding = Boolean(control?.holding_stop);
  const stillCritical = control?.machine_status === 'critical' && !control?.motor_off;

  return (
    <div className="glow-card rounded-xl bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Power size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Machine Control</h3>
        <span className="ml-auto text-[0.625rem] px-1.5 py-0.5 rounded-full bg-status-warning/15 status-warning font-semibold uppercase">
          demo — nothing sent
        </span>
      </div>

      {!control ? (
        <p className="text-xs text-muted-foreground py-4 text-center">Waiting for demo data…</p>
      ) : (
        <div className="space-y-3">
          <div className={`flex items-center gap-3 rounded-lg border p-3 ${holding ? 'border-status-critical/40 bg-status-critical/15' : 'border-status-normal/30 bg-status-normal/15'}`}>
            {holding
              ? <OctagonX size={22} className="status-critical shrink-0" />
              : <Power size={22} className="status-normal shrink-0" />}
            <div className="min-w-0">
              <p className={`font-bold ${holding ? 'status-critical' : 'status-normal'}`}>
                {holding ? 'Would send STOP — machine held stopped' : 'Machine running'}
              </p>
              <p className="text-xs text-muted-foreground">
                {holding
                  ? 'In real use the machine stays stopped until an operator confirms it is safe.'
                  : 'A STOP is sent automatically when the status becomes critical.'}
              </p>
            </div>
          </div>

          {control.would_send.length > 0 && (
            <ul className="space-y-1">
              {control.would_send.slice(0, 4).map(c => (
                <li key={`${c.timestamp}-${c.command}`} className="text-[0.6875rem] font-mono text-muted-foreground truncate">
                  {formatTime(c.timestamp)} · would send {c.command} · {c.reason}
                </li>
              ))}
            </ul>
          )}

          {holding && (
            <>
              <button
                onClick={onResume}
                disabled={stillCritical}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <PlayCircle size={16} /> Operator resume (demo)
              </button>
              {stillCritical && (
                <p className="text-[0.6875rem] status-critical">Machine is still critical — resume is blocked, as in real use.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default DemoControlPanel;
