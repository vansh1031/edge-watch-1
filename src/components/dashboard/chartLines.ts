// Chart line configs shared by the Dashboard and the Demo page
export const velocityLines = [
  { key: 'vRMSx' as const, color: '#3b82f6', label: 'vRMS-X' },
  { key: 'vRMSy' as const, color: '#22d3ee', label: 'vRMS-Y' },
  { key: 'vRMSz' as const, color: '#a78bfa', label: 'vRMS-Z' },
];
export const accelLines = [
  { key: 'aRMSx' as const, color: '#f59e0b', label: 'aRMS-X' },
  { key: 'aRMSy' as const, color: '#ef4444', label: 'aRMS-Y' },
  { key: 'aRMSz' as const, color: '#10b981', label: 'aRMS-Z' },
];
export const tempLines = [
  { key: 'temperature' as const, color: '#f97316', label: 'Temperature' },
];
export const acousticLines = [
  { key: 'aucausticRMS' as const, color: '#8b5cf6', label: 'Acoustic RMS' },
];
