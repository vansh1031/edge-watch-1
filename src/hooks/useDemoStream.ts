import { useState, useEffect } from 'react';
import { DemoSessionInfo, DemoTick, ForecastPoint, SensorData } from '@/types/sensor';
import { DEMO_STREAM_URL } from '@/services/api';

const MAX_POINTS = 300;   // 5 minutes at 1 reading / s

/**
 * One demo session per open Demo page (/api/demo/stream). The backend runs
 * its own copy of the model memory for it, so nothing here touches the live
 * dashboard. Closing the page ends the session.
 */
export function useDemoStream() {
  const [info, setInfo] = useState<DemoSessionInfo | null>(null);
  const [tick, setTick] = useState<DemoTick | null>(null);
  const [history, setHistory] = useState<SensorData[]>([]);
  const [health, setHealth] = useState<ForecastPoint[]>([]);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const source = new EventSource(DEMO_STREAM_URL);
    const parse = <T,>(e: Event) => JSON.parse((e as MessageEvent).data) as T;

    source.onerror = () => setConnected(false);
    source.addEventListener('session', e => {
      // A reconnect creates a new session on the backend → start clean
      const s = parse<DemoSessionInfo>(e);
      setInfo(s);
      setHistory(s.history.map(r => ({ ...r, timestamp: Number(r.timestamp) })));
      setHealth([]);
      setTick(null);
      setConnected(true);
    });
    source.addEventListener('tick', e => {
      const t = parse<DemoTick>(e);
      setTick(t);
      setConnected(true);
      setHistory(prev => [...prev, { ...t.reading, timestamp: Number(t.reading.timestamp) }].slice(-MAX_POINTS));
      setHealth(prev => [...prev, { timestamp: Number(t.reading.timestamp), value: t.prediction.health_score, predicted: false }]
        .slice(-MAX_POINTS));
    });

    return () => source.close();
  }, []);

  return { info, tick, history, health, connected };
}
