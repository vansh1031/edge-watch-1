import { useCallback } from 'react';
import { toast } from 'sonner';
import { FlaskConical, WifiOff } from 'lucide-react';
import TopBar from '@/components/dashboard/TopBar';
import StatusCards from '@/components/dashboard/StatusCards';
import PredictionCard from '@/components/dashboard/PredictionCard';
import FaultDetection from '@/components/dashboard/FaultDetection';
import RecommendationPanel from '@/components/dashboard/RecommendationPanel';
import AlertPanel from '@/components/dashboard/AlertPanel';
import SensorChart from '@/components/dashboard/SensorChart';
import HealthTrend from '@/components/dashboard/HealthTrend';
import DemoControls from '@/components/dashboard/DemoControls';
import DemoControlPanel from '@/components/dashboard/DemoControlPanel';
import { velocityLines, accelLines, tempLines, acousticLines } from '@/components/dashboard/chartLines';
import { useDemoStream } from '@/hooks/useDemoStream';
import { demoReset, demoResume, demoSetPreset, demoSetValues, toAlert } from '@/services/api';
import { SensorField } from '@/types/sensor';

/**
 * What-if Demo page. Runs its own simulated machine on the backend with its
 * own model memory: nothing here is stored, sent to a machine, or shown on
 * the Normal dashboard.
 */
const Demo = () => {
  const { info, tick, history, health, connected } = useDemoStream();
  const sid = info?.id;

  const call = useCallback((p: Promise<void>) => {
    p.catch(err => toast.error(err instanceof Error ? err.message : 'Demo request failed'));
  }, []);

  const onValues = useCallback((values: Partial<Record<SensorField, number>>) => {
    if (sid) call(demoSetValues(sid, values));
  }, [sid, call]);
  const onPreset = useCallback((preset: string) => { if (sid) call(demoSetPreset(sid, preset)); }, [sid, call]);
  const onReset = useCallback(() => { if (sid) call(demoReset(sid)); }, [sid, call]);
  const onResume = useCallback(() => { if (sid) call(demoResume(sid)); }, [sid, call]);

  return (
    <div className="min-h-screen bg-background">
      <TopBar isConnected={connected} useMock={false} />

      <main className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
        <div className="sticky top-0 z-30 -mx-1 px-1 py-1 bg-background/90 backdrop-blur">
          {connected ? (
            <div role="status" className="flex items-start gap-3 rounded-xl border border-status-warning/40 bg-status-warning/15 status-warning px-4 py-3">
              <FlaskConical size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Demo mode — what-if simulation</p>
                <p className="text-xs text-foreground/80 mt-0.5">
                  Change the sensor values and watch the AI react. Nothing here is stored, sent to a machine or shown
                  in Normal mode. Your values return to the simulated data {info ? `${info.hold_s} s` : 'shortly'} after you stop changing them.
                </p>
              </div>
            </div>
          ) : (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-status-critical/40 bg-status-critical/15 status-critical px-4 py-3">
              <WifiOff size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Backend unreachable</p>
                <p className="text-xs text-foreground/80 mt-0.5">The demo needs the Edge AI backend (port 5005). It reconnects automatically.</p>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          {/* ── Controls ── */}
          <div className="xl:col-span-1 xl:sticky xl:top-24">
            {info ? (
              <DemoControls info={info} tick={tick} onValues={onValues} onPreset={onPreset} onReset={onReset} />
            ) : (
              <div className="glow-card rounded-xl bg-card p-5 text-xs text-muted-foreground text-center">Starting demo…</div>
            )}
          </div>

          {/* ── Outputs ── */}
          <div className="xl:col-span-2 space-y-6">
            <StatusCards data={tick?.reading ?? null} anomaly={tick?.prediction ?? null} />
            <div>
              <h2 className="text-sm font-semibold text-accent uppercase mb-3">AI Predictive Maintenance</h2>
              <PredictionCard data={tick?.prediction ?? null} isLoading={!tick && connected} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <FaultDetection data={tick?.prediction ?? null} />
              <DemoControlPanel control={tick?.control ?? null} onResume={onResume} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RecommendationPanel data={tick?.recommendations ?? []} />
              <AlertPanel alerts={(tick?.alerts ?? []).map(toAlert)} readOnly />
            </div>
            <HealthTrend data={health} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <SensorChart data={history} title="Velocity RMS" lines={velocityLines} />
              <SensorChart data={history} title="Acceleration RMS" lines={accelLines} />
              <SensorChart data={history} title="Temperature" lines={tempLines} />
              <SensorChart data={history} title="Acoustic RMS" lines={acousticLines} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Demo;
