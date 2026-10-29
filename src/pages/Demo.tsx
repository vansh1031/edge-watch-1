import { useCallback, lazy, Suspense } from 'react';
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

// three.js is large → loaded after the rest of the page
const MachineView = lazy(() => import('@/components/machine/MachineView'));

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

  const cardGrid = 'grid grid-cols-2 md:grid-cols-4 xl:grid-cols-2 gap-3';

  // Wide screens: one screen, no page scroll — controls | 3D machine | results,
  // controls and results each scroll on their own. Narrow screens: normal page scroll.
  return (
    <div className="min-h-screen xl:h-screen xl:overflow-hidden flex flex-col bg-background">
      <TopBar isConnected={connected} useMock={false} />

      <div className="px-4 pt-3 shrink-0">
        {connected ? (
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-status-warning/40 bg-status-warning/15 status-warning px-3 py-2">
            <FlaskConical size={16} className="shrink-0" />
            <p className="text-sm font-semibold">Demo mode — what-if simulation</p>
            <p className="text-xs text-foreground/80">
              Nothing here is stored, sent to a machine or shown in Normal mode. Values return to the simulated data {info ? `${info.hold_s} s` : 'shortly'} after you stop changing them.
            </p>
          </div>
        ) : (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-status-critical/40 bg-status-critical/15 status-critical px-3 py-2">
            <WifiOff size={16} className="shrink-0" />
            <p className="text-sm font-semibold">Backend unreachable</p>
            <p className="text-xs text-foreground/80">The demo needs the Edge AI backend (port 5005). It reconnects automatically.</p>
          </div>
        )}
      </div>

      <main className="flex-1 min-h-0 p-4 grid grid-cols-1 xl:grid-cols-[20rem_minmax(0,1fr)_25rem] 2xl:grid-cols-[22.5rem_minmax(0,1fr)_28.75rem] gap-4">
        {/* ── Controls (scrolls on its own) ── */}
        <div className="xl:min-h-0 xl:overflow-y-auto scrollbar-thin xl:pr-1 order-2 xl:order-1">
          {info ? (
            <DemoControls info={info} tick={tick} onValues={onValues} onPreset={onPreset} onReset={onReset} />
          ) : (
            <div className="glow-card rounded-xl bg-card p-5 text-xs text-muted-foreground text-center">Starting demo…</div>
          )}
        </div>

        {/* ── 3D machine (always visible) ── */}
        <div className="xl:min-h-0 h-[26rem] xl:h-auto order-1 xl:order-2">
          <Suspense fallback={<div className="glow-card rounded-xl bg-card h-full" />}>
            <MachineView
              reading={tick?.reading ?? null}
              status={tick?.prediction.status ?? null}
              faultType={tick?.prediction.fault_type ?? null}
              motorOff={Boolean(tick?.prediction.motor_off)}
              limits={info?.thresholds as Record<string, { warning: number; critical: number }> | undefined}
              className="h-full"
            />
          </Suspense>
        </div>

        {/* ── Results (scrolls on its own) ── */}
        <div className="xl:min-h-0 xl:overflow-y-auto scrollbar-thin xl:pr-1 space-y-4 order-3">
          <StatusCards data={tick?.reading ?? null} anomaly={tick?.prediction ?? null} gridClassName={cardGrid} compact />
          <PredictionCard data={tick?.prediction ?? null} isLoading={!tick && connected} gridClassName={cardGrid} compact />
          <FaultDetection data={tick?.prediction ?? null} />
          <DemoControlPanel control={tick?.control ?? null} onResume={onResume} />
          <RecommendationPanel data={tick?.recommendations ?? []} />
          <AlertPanel alerts={(tick?.alerts ?? []).map(toAlert)} readOnly />
          <HealthTrend data={health} />
          <SensorChart data={history} title="Velocity RMS" lines={velocityLines} />
          <SensorChart data={history} title="Acceleration RMS" lines={accelLines} />
          <SensorChart data={history} title="Temperature" lines={tempLines} />
          <SensorChart data={history} title="Acoustic RMS" lines={acousticLines} />
        </div>
      </main>
    </div>
  );
};

export default Demo;
