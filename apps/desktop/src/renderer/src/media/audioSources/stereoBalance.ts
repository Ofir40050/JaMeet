export function getStereoBalanceGains(pan: number): { left: number; right: number } {
  const clamped = Math.max(-1, Math.min(1, pan));
  const left = clamped <= 0 ? 1.0 : Math.max(0, 1.0 - clamped);
  const right = clamped >= 0 ? 1.0 : Math.max(0, 1.0 + clamped);
  return { left, right };
}
