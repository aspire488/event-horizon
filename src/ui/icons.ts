const wrap = (paths: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS: Record<string, string> = {
  observe: wrap(
    '<path d="M2.2 12S5.6 6.2 12 6.2 21.8 12 21.8 12 18.4 17.8 12 17.8 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  ),
  gravity: wrap(
    '<circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="5.4" stroke-dasharray="1.5 3"/><circle cx="12" cy="12" r="9.4" stroke-dasharray="1.5 4.4"/><path d="M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21"/>',
  ),
  blackhole: wrap(
    '<circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9.6" ry="3.1"/><path d="M4.6 9.9c1.4.5 4 1 7.4 1s6-.5 7.4-1M4.6 14.1c1.4-.5 4-1 7.4-1s6 .5 7.4 1" opacity=".55"/>',
  ),
  supernova: wrap(
    '<circle cx="12" cy="12" r="2.4"/><path d="M12 2.4v3.2M12 18.4v3.2M2.4 12h3.2M18.4 12h3.2M5.3 5.3l2.2 2.2M16.5 16.5l2.2 2.2M18.7 5.3l-2.2 2.2M7.5 16.5l-2.2 2.2"/><circle cx="12" cy="12" r="6.1" stroke-dasharray="1.4 3.4" opacity=".7"/>',
  ),
  repel: wrap(
    '<circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M12 4.4V8M12 16v3.6M4.4 12H8M16 12h3.6M6.6 6.6l2.4 2.4M15 15l2.4 2.4M17.4 6.6 15 9M9 15l-2.4 2.4"/>',
  ),
  paint: wrap(
    '<path d="M3.2 19.4c3.4-1 5.6-6.4 8.6-6.4 2.4 0 2.8 2.6 5.4 2.6"/><circle cx="18.6" cy="7.4" r="1.5"/><circle cx="6.4" cy="21" r="1.2" opacity=".6"/><path d="M5 9.6c1.6-2.4 4-4 6.4-4" stroke-dasharray="1.4 2.8" opacity=".6"/>',
  ),
  orbit: wrap(
    '<ellipse cx="12" cy="12" rx="9.2" ry="4.4" transform="rotate(-22 12 12)"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="19.4" cy="8.4" r="1.6" fill="currentColor" stroke="none"/>',
  ),
  pause: wrap('<path d="M9 5.4v13.2M15 5.4v13.2" stroke-width="1.8"/>'),
  play: wrap('<path d="M8 4.8 19 12 8 19.2Z" fill="currentColor" stroke="none"/>'),
  undo: wrap('<path d="M9 5 4 10l5 5"/><path d="M4.6 10H14a5.4 5.4 0 0 1 0 10.8H9"/>'),
  redo: wrap('<path d="m15 5 5 5-5 5"/><path d="M19.4 10H10a5.4 5.4 0 0 0 0 10.8h5"/>'),
  reset: wrap('<path d="M4.2 12a7.8 7.8 0 1 0 2.3-5.5"/><path d="M4 4.5V9h4.5"/>'),
  sound: wrap(
    '<path d="M4 9.6h3.2L12 5.4v13.2L7.2 14.4H4Z"/><path d="M15.4 9a4 4 0 0 1 0 6"/><path d="M18 6.4a7.6 7.6 0 0 1 0 11.2"/>',
  ),
  mute: wrap(
    '<path d="M4 9.6h3.2L12 5.4v13.2L7.2 14.4H4Z"/><path d="m16 9.4 5 5M21 9.4l-5 5"/>',
  ),
  perf: wrap('<path d="M3.6 15.6a8.6 8.6 0 1 1 16.8 0"/><path d="m12 12 4-3.2"/><circle cx="12" cy="14.6" r="1.4" fill="currentColor" stroke="none"/>'),
  help: wrap('<circle cx="12" cy="12" r="8.8"/><path d="M9.4 9.2A2.7 2.7 0 1 1 12.6 12c-.6.5-.9 1-.9 1.8"/><circle cx="11.9" cy="17" r=".9" fill="currentColor" stroke="none"/>'),
  close: wrap('<path d="m6 6 12 12M18 6 6 18"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  minus: wrap('<path d="M5 12h14"/>'),
  trash: wrap('<path d="M4.5 7h15M9.4 7V4.8h5.2V7"/><path d="M6.6 7l.9 12.2h9l.9-12.2"/><path d="M10.4 11v4.8M13.6 11v4.8" opacity=".65"/>'),
  download: wrap('<path d="M12 4v10.4M7.8 10.6 12 14.8l4.2-4.2"/><path d="M4.8 17v2.2h14.4V17"/>'),
  upload: wrap('<path d="M12 14.8V4.4M7.8 8.6 12 4.4l4.2 4.2"/><path d="M4.8 17v2.2h14.4V17"/>'),
  save: wrap('<path d="M5 4.6h11.4L19.4 8v11.4H5Z"/><path d="M8 4.6v5h7v-5M8.4 19.4v-6h7.2v6"/>'),
  edit: wrap('<path d="m4.6 19.4.8-4.4L16.2 4.2l3.6 3.6L9 18.6Z"/><path d="m14.4 6 3.6 3.6"/>'),
  locate: wrap('<circle cx="12" cy="12" r="6.6"/><path d="M12 2.4V6M12 18v3.6M2.4 12H6M18 12h3.6"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  layers: wrap('<path d="m12 3.4 8.4 4.4L12 12.2 3.6 7.8Z"/><path d="m4.4 12.2 7.6 4 7.6-4M4.4 16.4l7.6 4 7.6-4"/>'),
  gauge: wrap('<path d="M4 17.6a8.6 8.6 0 1 1 16 0"/><path d="M12 17.4v-4.8M7 17.6h10" opacity=".8"/>'),
  panel: wrap('<rect x="3.6" y="4.4" width="16.8" height="15.2" rx="1.4"/><path d="M14.4 4.4v15.2"/>'),
  check: wrap('<path d="m4.8 12.4 4.6 4.4 9.8-10"/>'),
  arrowright: wrap('<path d="M4.6 12h14.4M14 6.4l5.6 5.6-5.6 5.6"/>'),
  spark: wrap(
    '<path d="M12 2.8v4M12 17.2v4M2.8 12h4M17.2 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  ),
};

export function icon(name: string, className = 'icon'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.innerHTML = ICONS[name] ?? ICONS.spark;
  return span;
}
