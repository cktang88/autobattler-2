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
/** Fetches a screen's code on first visit (a dynamic import), so the first page load only carries the menu. */
export type ScreenLoader<R extends Route = Route> = () => Promise<ScreenFn<R>>;

export class App {
  readonly root: HTMLElement;
  private screens = new Map<string, ScreenFn<any>>();
  private loaders = new Map<string, () => Promise<ScreenFn<any>>>();
  private current: Screen | null = null;
  /** bumped on every go(): a lazy screen that finishes loading after a newer go() is not shown */
  private nav = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  register<N extends Route['name']>(name: N, fn: ScreenFn<Extract<Route, { name: N }>>): void {
    this.screens.set(name, fn);
  }

  /** Register a screen whose module loads on first use. The load is shared, so prefetch() and go() never fetch twice. */
  registerLazy<N extends Route['name']>(name: N, load: ScreenLoader<Extract<Route, { name: N }>>): void {
    let p: Promise<ScreenFn<any>> | null = null;
    this.loaders.set(name, () => (p ??= load().then((fn) => { this.screens.set(name, fn); return fn; }, (e) => { p = null; throw e; })));
  }

  /** Warm up lazy screens in the background (after the first screen is up) so later clicks open instantly. */
  prefetch(): void {
    for (const [name, load] of this.loaders) if (!this.screens.has(name)) load().catch((e) => console.warn(`prefetch ${name}`, e));
  }

  go(route: Route): void {
    const ticket = ++this.nav;
    const fn = this.screens.get(route.name);
    if (fn) { this.show(fn, route); return; }
    const load = this.loaders.get(route.name);
    if (!load) throw new Error(`no screen ${route.name}`);
    document.body.classList.add('app-loading');
    load().then(
      (f) => { if (ticket === this.nav) this.show(f, route); },
      (e) => {
        console.error(e);
        if (ticket !== this.nav) return;
        document.body.classList.remove('app-loading');
        this.toast('Could not load that screen. Check your connection and try again.', 'error');
      },
    );
  }

  private show(fn: ScreenFn<any>, route: Route): void {
    document.body.classList.remove('app-loading');
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
