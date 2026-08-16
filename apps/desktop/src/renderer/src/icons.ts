/**
 * JaMeet High-End SVG Icon System
 * Standardized 24x24 stroke-based SVG icons (Lucide / Studio grade).
 * Fully scalable, retina-crisp, dark-theme optimized with currentColor support.
 */

export interface IconOptions {
  size?: number | string;
  className?: string;
  strokeWidth?: number | string;
  ariaHidden?: boolean;
}

function createSvg(pathContent: string, defaultClass = 'ui-icon'): (opts?: IconOptions) => string {
  return (opts?: IconOptions) => {
    const size = opts?.size ?? 18;
    const strokeWidth = opts?.strokeWidth ?? 2;
    const className = opts?.className ? `${defaultClass} ${opts.className}` : defaultClass;
    const aria = opts?.ariaHidden !== false ? 'aria-hidden="true"' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${className}" ${aria}>${pathContent}</svg>`;
  };
}

export const icons = {
  key: createSvg(
    '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/>'
  ),

  sparkles: createSvg(
    '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>'
  ),

  user: createSvg(
    '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>'
  ),

  users: createSvg(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
  ),

  lock: createSvg(
    '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
  ),

  shieldCheck: createSvg(
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'
  ),

  zap: createSvg(
    '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'
  ),

  link: createSvg(
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'
  ),

  music: createSvg(
    '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'
  ),

  disc: createSvg(
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/><path d="M12 2a10 10 0 0 1 10 10"/>'
  ),

  plus: createSvg(
    '<path d="M5 12h14"/><path d="M12 5v14"/>'
  ),

  refresh: createSvg(
    '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>'
  ),

  clock: createSvg(
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
  ),

  headphones: createSvg(
    '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>'
  ),

  clipboard: createSvg(
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/>'
  ),

  copy: createSvg(
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
  ),

  sliders: createSvg(
    '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/>'
  ),

  crown: createSvg(
    '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.269a4 4 0 0 1-3.854 2.937H8.707a4 4 0 0 1-3.854-2.937L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z"/>'
  ),

  fileText: createSvg(
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'
  ),

  stickyNote: createSvg(
    '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/>'
  ),

  edit: createSvg(
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'
  ),

  archive: createSvg(
    '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'
  ),

  trash: createSvg(
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'
  ),

  x: createSvg(
    '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
  ),

  video: createSvg(
    '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11"/><rect width="14" height="12" x="2" y="6" rx="2"/>'
  ),

  videoOff: createSvg(
    '<path d="M10.66 6H14a2 2 0 0 1 2 2v3.34l1 1L22 8v8"/><path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><line x1="2" x2="22" y1="2" y2="22"/>'
  ),

  volume2: createSvg(
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'
  ),

  mic: createSvg(
    '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'
  ),

  micOff: createSvg(
    '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>'
  ),

  guitar: createSvg(
    '<path d="m11.9 12.1 6.8-6.8a1 1 0 0 1 1.4 0l1.8 1.8a1 1 0 0 1 0 1.4l-6.8 6.8"/><path d="M14 6 8.5 11.5a5.5 5.5 0 1 0 7.78 7.78L21.7 13.8"/><circle cx="12" cy="16" r="1.5"/>'
  ),

  monitor: createSvg(
    '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>'
  ),

  stopSquare: createSvg(
    '<rect width="16" height="16" x="4" y="4" rx="2"/>'
  ),

  barChart: createSvg(
    '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>'
  ),

  settings: createSvg(
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'
  ),

  phoneOff: createSvg(
    '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="2" x2="22" y1="2" y2="22"/>'
  ),

  chevronDown: createSvg(
    '<path d="m6 9 6 6 6-6"/>'
  ),

  arrowRight: createSvg(
    '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'
  ),

  arrowLeft: createSvg(
    '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'
  ),

  moreHorizontal: createSvg(
    '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'
  ),

  check: createSvg(
    '<polyline points="20 6 9 17 4 12"/>'
  ),

  alertTriangle: createSvg(
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>'
  ),

  info: createSvg(
    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
  ),

  lightbulb: createSvg(
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'
  ),

  piano: createSvg(
    '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 4v8"/><path d="M10 4v8"/><path d="M14 4v8"/><path d="M18 4v8"/>'
  ),

  appWindow: createSvg(
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><circle cx="6" cy="6" r=".5"/>'
  ),

  logout: createSvg(
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'
  ),

  mail: createSvg(
    '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'
  ),

  tag: createSvg(
    '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r=".5" fill="currentColor"/>'
  ),

  messageSquare: createSvg(
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
  ),

  waveform: createSvg(
    '<path d="M2 10v4"/><path d="M6 6v12"/><path d="M10 3v18"/><path d="M14 8v8"/><path d="M18 5v14"/><path d="M22 10v4"/>'
  ),

  laptop: createSvg(
    '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>'
  ),

  statusDotConnected: createSvg(
    '<circle cx="12" cy="12" r="5" fill="#22c55e" stroke="#16a34a"/>',
    'status-dot-icon status-green'
  ),

  statusDotConnecting: createSvg(
    '<circle cx="12" cy="12" r="5" fill="#eab308" stroke="#ca8a04"/>',
    'status-dot-icon status-yellow'
  ),

  statusDotStandby: createSvg(
    '<circle cx="12" cy="12" r="5" fill="#94a3b8" stroke="#64748b"/>',
    'status-dot-icon status-gray'
  ),

  layoutGrid: createSvg(
    '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'
  ),

  layoutColumns: createSvg(
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>'
  ),

  layoutSpeaker: createSvg(
    '<rect width="18" height="18" x="3" y="3" rx="2"/><rect width="6" height="5" x="13" y="14" rx="1"/>'
  ),

  pin: createSvg(
    '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V6a3 3 0 0 0-6 0v4.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"/>'
  ),

  sideBySide: createSvg(
    '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="13" x2="13" y1="3" y2="17"/>'
  ),

  maximize: createSvg(
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'
  ),

  logo: createSvg(
    '<path d="M4 12V8a4 4 0 0 1 4-4h2"/><path d="M8 12h8"/><path d="M12 4v16"/><path d="M16 12v4a4 4 0 0 1-4 4h-2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>'
  )
};

export type IconName = keyof typeof icons;

export function getIcon(name: IconName, opts?: IconOptions): string {
  if (icons[name]) {
    return icons[name](opts);
  }
  return '';
}
