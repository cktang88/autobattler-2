// Worker side of pool.ts: import the requested module, call the named export, post the result (or the error) back.
import { parentPort } from 'node:worker_threads';

parentPort!.on('message', async ({ mod, fn, args }: { mod: string; fn: string; args: unknown[] }) => {
  try {
    const m = await import(mod);
    parentPort!.postMessage({ ok: true, value: await m[fn](...args) });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error });
  }
});
