// Run expensive, independent pieces of a test (one AI match, one 3D build) on worker threads so a CPU-heavy test file
// uses every core instead of one. node --test already runs files in parallel; this splits the work inside a slow file.
//
//   const m = await inWorker<MatchState>(new URL('./aimatch.ts', import.meta.url), 'playMatch', 100, 'easy', 'hard');
//
// The named export is called in a worker with the (structured-cloned) args and its result is cloned back. Workers are
// unref'd, so an idle pool never keeps the test process alive. TEST_WORKERS=0 runs everything in-process (debugging).
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

interface Job { mod: string; fn: string; args: unknown[]; resolve: (v: unknown) => void; reject: (e: unknown) => void }
interface Slot { w: Worker; job?: Job }

const SIZE = Number(process.env.TEST_WORKERS ?? Math.max(1, availableParallelism() - 1));
const slots: Slot[] = [];
const queue: Job[] = [];

function spawn(): Slot {
  const slot: Slot = { w: new Worker(new URL('./worker.ts', import.meta.url)) };
  slot.w.unref();
  slot.w.on('message', (msg: { ok: boolean; value?: unknown; error?: unknown }) => {
    const job = slot.job!;
    slot.job = undefined;
    slot.w.unref();
    if (msg.ok) job.resolve(msg.value);
    else job.reject(msg.error);
    pump();
  });
  slot.w.on('error', (e) => {
    slot.job?.reject(e);
    slots.splice(slots.indexOf(slot), 1);
    pump();
  });
  slots.push(slot);
  return slot;
}

function pump() {
  while (queue.length) {
    const slot = slots.find((s) => !s.job) ?? (slots.length < SIZE ? spawn() : undefined);
    if (!slot) return;
    const job = (slot.job = queue.shift()!);
    slot.w.ref(); // a busy worker keeps the process alive until its result is in
    slot.w.postMessage({ mod: job.mod, fn: job.fn, args: job.args });
  }
}

export function inWorker<T>(mod: URL, fn: string, ...args: unknown[]): Promise<T> {
  if (SIZE <= 0) return import(mod.href).then((m) => m[fn](...args) as T);
  return new Promise<T>((resolve, reject) => {
    queue.push({ mod: mod.href, fn, args, resolve: resolve as (v: unknown) => void, reject });
    pump();
  });
}
