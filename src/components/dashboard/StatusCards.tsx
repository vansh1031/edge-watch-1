import { Activity, Thermometer, Volume2, Heart } from 'lucide-react';
import { LiveData, MachineStatus, PredictionData } from '@/types/sensor';

type CardStatus = MachineStatus | 'unknown';

interface StatusCardsProps {
  data: LiveData | null;
  anomaly?: Pick<PredictionData, 'health_score' | 'status'> | null;
  isLoading?: boolean;
  gridClassName?: string;     // e.g. 2 columns when placed beside the 3D view
  compact?: boolean;          // smaller padding / numbers on wide layouts
}

function statusColor(status: CardStatus) {
  if (status === 'critical') return 'text-red-500';
  if (status === 'warning') return 'text-yellow-400';
  if (status === 'unknown') return 'text-muted-foreground';
  return 'text-green-400';
}

function statusBg(status: CardStatus) {
  if (status === 'critical') return 'bg-red-500/20';
  if (status === 'warning') return 'bg-yellow-400/20';
  if (status === 'unknown') return 'bg-muted';
  return 'bg-green-400/20';
}

function statusText(status: CardStatus) {
  if (status === 'normal') return 'Operating normally';
  if (status === 'warning') return 'Attention needed';
  if (status === 'critical') return 'Immediate action';
  return 'No data';
}

const StatusCards = ({ data, anomaly, gridClassName = 'grid grid-cols-2 lg:grid-cols-4 gap-4', compact = false }: StatusCardsProps) => {
  // ✅ Health + status come from the ML model (/api/prediction),
  //    sensor levels from the backend thresholds (/api/live-data) — no thresholds here
  const machineStatus: CardStatus = anomaly?.status ?? 'unknown';
  const hasData = data !== null && typeof data.temperature === 'number';

  const cards: { label: string; value: string; icon: typeof Heart; status: CardStatus }[] = [
    {
      label: 'Health Score',
      value: anomaly ? `${Math.round(anomaly.health_score)}%` : '--',
      icon: Heart,
      status: machineStatus,
    },
    {
      label: 'Machine Status',
      value: anomaly ? machineStatus.charAt(0).toUpperCase() + machineStatus.slice(1) : '--',
      icon: Activity,
      status: machineStatus,
    },
    {
      label: 'Temperature',
      value: hasData ? `${data.temperature.toFixed(1)}°C` : '--',
      icon: Thermometer,
      status: hasData ? data.levels?.temperature ?? 'normal' : 'unknown',
    },
    {
      label: 'Acoustic RMS',
      value: hasData ? `${Number(data.aucausticRMS ?? 0).toFixed(1)} dB` : '--',
      icon: Volume2,
      status: hasData ? data.levels?.aucausticRMS ?? 'normal' : 'unknown',
    },
  ];

  return (
    <div className={gridClassName}>
      {cards.map((card) => (
        <div
          key={card.label}
          className={`glow-card rounded-xl bg-card ${compact ? 'p-4' : 'p-5'} transition-all duration-300 hover:scale-[1.02]`}
        >
          {/* Header */}
          <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-3'}`}>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {card.label}
            </span>
            <div className={`p-1.5 rounded-lg ${statusBg(card.status)}`}>
              <card.icon size={14} className={statusColor(card.status)} />
            </div>
          </div>

          {/* Value */}
          <div className={`${compact ? 'text-2xl' : 'text-3xl'} font-bold tracking-tight ${statusColor(card.status)}`}>
            {card.value}
          </div>

          {/* Status text */}
          <div className={`${compact ? 'mt-1' : 'mt-2'} flex items-center gap-1.5`}>
            <div className={`w-1.5 h-1.5 rounded-full bg-current ${statusColor(card.status)} animate-pulse`} />
            <span className={`text-xs ${statusColor(card.status)}`}>
              {statusText(card.status)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StatusCards;
