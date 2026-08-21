export function faderTopPercentToDb(pct: number): number {
  if (pct >= 98.5) return -Infinity;
  if (pct <= 2.0) return 6.0;
  if (pct <= 16.0) {
    return 6.0 - ((pct - 2.0) / 14.0) * 6.0;
  } else if (pct <= 32.0) {
    return 0.0 - ((pct - 16.0) / 16.0) * 6.0;
  } else if (pct <= 48.0) {
    return -6.0 - ((pct - 32.0) / 16.0) * 6.0;
  } else if (pct <= 74.0) {
    return -12.0 - ((pct - 48.0) / 26.0) * 12.0;
  } else if (pct <= 92.0) {
    return -24.0 - ((pct - 74.0) / 18.0) * 16.0;
  } else {
    return -40.0 - ((pct - 92.0) / 6.5) * 25.0;
  }
}

export function dbToFaderTopPercent(db: number): number {
  if (db === -Infinity || db <= -65) return 98.5;
  if (db >= 6.0) return 2.0;
  if (db >= 0.0) {
    return 2.0 + ((6.0 - db) / 6.0) * 14.0;
  } else if (db >= -6.0) {
    return 16.0 + ((-db) / 6.0) * 16.0;
  } else if (db >= -12.0) {
    return 32.0 + ((-db - 6.0) / 6.0) * 16.0;
  } else if (db >= -24.0) {
    return 48.0 + ((-db - 12.0) / 12.0) * 26.0;
  } else if (db >= -40.0) {
    return 74.0 + ((-db - 24.0) / 16.0) * 18.0;
  } else {
    return 92.0 + ((-db - 40.0) / 25.0) * 6.5;
  }
}

export function dbToGain(db: number): number {
  if (db === -Infinity || db <= -65) return 0;
  return Math.pow(10, db / 20);
}

export function formatDbText(db: number): string {
  if (db === -Infinity || db <= -65) return '-∞';
  if (Math.abs(db) < 0.05) return '0.0';
  return db > 0 ? `+${db.toFixed(1)}` : `${db.toFixed(1)}`;
}

export function formatPeakDbText(db: number): string {
  if (db === -Infinity || db <= -55) return '';
  if (Math.abs(db) < 0.05) return '0.0';
  return db > 0 ? `+${db.toFixed(1)}` : `${db.toFixed(1)}`;
}

export function volumeToDb(vol: number): string {
  if (vol <= 0.0001) return '-∞';
  const db = 20 * Math.log10(vol);
  return formatDbText(db);
}

export function getPanBackground(pan: number): string {
  const panVal = Math.round(pan * 50); // -50 to +50
  if (panVal === 0) return '#232326';
  if (panVal > 0) {
    const deg = (panVal / 50) * 140;
    return `conic-gradient(from 0deg, #22c55e 0deg, #22c55e ${deg.toFixed(1)}deg, #232326 ${deg.toFixed(1)}deg, #232326 360deg)`;
  } else {
    const deg = (-panVal / 50) * 140;
    const startDeg = 360 - deg;
    return `conic-gradient(from 0deg, #232326 0deg, #232326 ${startDeg.toFixed(1)}deg, #22c55e ${startDeg.toFixed(1)}deg, #22c55e 360deg)`;
  }
}

export function panToReadout(pan: number): string {
  const val = Math.round(pan * 50);
  if (val === 0) return '0';
  return val > 0 ? `+${val}` : `${val}`;
}

export function panToLabel(pan: number): string {
  const val = Math.round(pan * 50);
  if (val === 0) return '0';
  return val > 0 ? `+${val}` : `${val}`;
}

export function getStereoPanGains(pan: number): { left: number; right: number } {
  const clamped = Math.max(-1, Math.min(1, pan));
  const left = clamped <= 0 ? 1.0 : Math.max(0, 1.0 - clamped);
  const right = clamped >= 0 ? 1.0 : Math.max(0, 1.0 + clamped);
  return { left, right };
}
