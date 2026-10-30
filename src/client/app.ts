// Tiny screen router. Screens are plain DOM; each returns an element plus optional cleanup.

import type { MatchDriver } from './driver.ts';
import type { TugLaunch } from './ui/tug.ts';

export type Route =
  | { name: 'menu' }
  | { name: 'garage' }
  /** from: 'lobby' / 'menu' = just the loadout (deck) editor: Done returns there instead of starting an AI match */
  | { name: 'vsai'; from?: 'lobby' | 'menu' }
  | { name: 'lobby' }
  | { name: 'match'; driver: MatchDriver }
  /** sandbox: place any designs on both sides for free and watch them fight */
  | { name: 'playground' }
  | { name: 'settings' }
  /** tug of war: roster + opponent setup, and the live game */
  /** a game mode's page: choose vs AI or vs players */
  | { name: 'classic' }
  | { name: 'tug' }
  | { name: 'tugmatch'; launch: TugLaunch };

export interface Screen {
  el: HTMLElement;
  destroy?(): void;
}

export type ScreenFn<R extends Route = Route> = (app: App, route: R) => Screen;

export class App {
  readonly root: HTMLElement;
  private screens = new Map<string, ScreenFn<any>>();
  private current: Screen | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  register<N extends Route['name']>(name: N, fn: ScreenFn<Extract<Route, { name: N }>>): void {
    this.screens.set(name, fn);
  }

  go(route: Route): void {
    const fn = this.screens.get(route.name);
    if (!fn) throw new Error(`no screen ${route.name}`);
    this.current?.destroy?.();
    this.root.replaceChildren();
    this.current = fn(this, route);
    this.root.append(this.current.el);
  }

  toast(msg: string, kind: 'info' | 'error' | 'good' = 'info'): void {
    const t = document.createElement('div');
    t.className = `toast toast-${kind}`;
    t.textContent = msg;
    document.body.append(t);
    setTimeout(() => t.classList.add('toast-out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }
}

/** Small DOM helper: h('div.cls#id', {attrs}, ...children) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Record<string, any> | null = null,
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag)!;
  const el = document.createElement(m[1] as K);
  for (const part of m[2].match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') {
        // custom properties (--x) only take effect through setProperty
        for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
          else (el.style as unknown as Record<string, string>)[sk] = String(sv);
        }
      }
      else if (k === 'class') el.className += ' ' + v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}
