/** Minimal DOM building helpers. */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export const uiRoot = (): HTMLElement => document.getElementById('ui')!;
export const labelRoot = (): HTMLElement => document.getElementById('labels')!;

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Modal window on parchment. Returns the window element and a close function. */
export function modal(title: string, body: Node, opts: { footer?: Node[]; onClose?: () => void; width?: number; plain?: boolean } = {}) {
  const close = () => {
    overlay.remove();
    opts.onClose?.();
  };
  const win = h(
    'div',
    { class: `window parchment ${opts.plain ? 'plain' : ''}`, style: opts.width ? `width:${opts.width}px` : undefined },
    h('header', null, h('h2', null, title), h('button', { class: 'btn small close', onclick: close }, '✕')),
    h('div', { class: 'body' }, body),
    opts.footer?.length ? h('footer', null, ...opts.footer) : null,
  );
  const overlay = h('div', { class: 'overlay', onpointerdown: (e: Event) => { if (e.target === overlay) close(); } }, win);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && overlay.isConnected) {
      e.stopPropagation();
      close();
    }
    if (!overlay.isConnected) window.removeEventListener('keydown', onKey, true);
  };
  window.addEventListener('keydown', onKey, true);
  uiRoot().append(overlay);
  return { win, overlay, close };
}

let toastBox: HTMLElement | null = null;
export function toast(msg: string, ms = 3500): void {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = h('div', { class: 'toasts' });
    uiRoot().append(toastBox);
  }
  const t = h('div', { class: 'toast wood' }, msg);
  toastBox.append(t);
  setTimeout(() => t.remove(), ms);
}
