/** small frames-per-second readout for the battle screens: count frames, repaint the text twice a second */
export function createFpsMeter(parent: HTMLElement) {
  const el = document.createElement('div');
  el.className = 'fps';
  parent.append(el);
  let frames = 0, since = performance.now(), worst = 0, prev = since;
  return {
    /** call once per animation frame */
    tick(now: number) {
      frames++;
      worst = Math.max(worst, now - prev);
      prev = now;
      const span = now - since;
      if (span < 500) return;
      const fps = Math.round((frames * 1000) / span);
      el.textContent = `${fps} fps`;
      el.title = `slowest frame ${Math.round(worst)} ms`;
      el.classList.toggle('slow', fps < 40 || worst > 100);
      frames = 0; since = now; worst = 0;
    },
    destroy() { el.remove(); },
  };
}
