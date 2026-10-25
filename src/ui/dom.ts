export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(
  label: string,
  options: { className?: string; title?: string; onClick?: () => void; iconName?: string } = {},
): HTMLButtonElement {
  const btn = el('button', `ui-button ${options.className ?? ''}`.trim());
  btn.type = 'button';
  if (options.title) btn.title = options.title;
  if (options.iconName) {
    const span = el('span', 'icon');
    span.innerHTML = ICON_CACHE[options.iconName] ?? '';
    btn.appendChild(span);
  }
  if (label) btn.appendChild(el('span', 'ui-button-label', label));
  if (options.onClick) btn.addEventListener('click', options.onClick);
  return btn;
}

let ICON_CACHE: Record<string, string> = {};
/** Set once at boot by the UI module to avoid importing icons everywhere. */
export function provideIcons(icons: Record<string, string>): void {
  ICON_CACHE = icons;
}

export function iconNode(name: string): HTMLSpanElement {
  const span = el('span', 'icon');
  span.innerHTML = ICON_CACHE[name] ?? '';
  return span;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (value: number) => string;
  onInput: (value: number) => void;
  title?: string;
}

export function slider(options: SliderOptions): HTMLElement {
  const root = el('label', 'slider');
  if (options.title) root.title = options.title;
  const head = el('div', 'slider-head');
  const name = el('span', 'slider-label', options.label);
  const value = el('span', 'slider-value', formatSlider(options.value, options));
  const input = el('input', 'slider-input');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.value = String(options.value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = formatSlider(v, options);
    options.onInput(v);
  });
  head.append(name, value);
  root.append(head, input);
  return root;
}

function formatSlider(value: number, options: SliderOptions): string {
  if (options.format) return options.format(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function sectionHead(title: string, aside?: string): HTMLElement {
  const head = el('div', 'section-head');
  head.appendChild(el('h2', 'section-title', title));
  if (aside) head.appendChild(el('span', 'section-aside', aside));
  return head;
}

export function tag(text: string, variant = ''): HTMLElement {
  return el('span', `tag ${variant}`.trim(), text);
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, seconds);
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  const tenths = Math.floor((total * 10) % 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('en-US');
  if (Math.abs(value) >= 100) return value.toFixed(0);
  return value.toFixed(1);
}

export function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
