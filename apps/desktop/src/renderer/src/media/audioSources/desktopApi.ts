export function getDesktopApi(): any {
  if (typeof window === 'undefined') return undefined;
  return (window as any).jameet || (window as any).musiczoom;
}
