import { create } from 'zustand';
import type { ChatTurn, FromWorker, ModelConfig, ModelStatus, ToWorker } from './protocol';

/* The page's side of the model: one worker, started on first use, and the state the pill shows. */

const DEFAULT_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';

/** ?model= &dtype= &device= &system= &temp= &max= in the address swap the model and its settings. */
function readConfig(): ModelConfig {
  const q = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const num = (key: string, fallback: number) => {
    const v = Number(q.get(key));
    return q.get(key) !== null && Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const device = q.get('device');
  return {
    model: q.get('model') || DEFAULT_MODEL,
    dtype: q.get('dtype') || undefined,
    device: device === 'webgpu' || device === 'wasm' ? device : undefined,
    system: q.get('system') ?? undefined,
    temperature: num('temp', 0.7),
    maxNewTokens: Math.max(1, Math.round(num('max', 320))),
    // the check asks an English question, so by default only the model it was written for gets it
    check: q.has('check') ? q.get('check') !== '0' : !q.get('model'),
    debug: q.has('debug'),
  };
}

export const modelConfig = readConfig();
export const isDefaultModel = modelConfig.model === DEFAULT_MODEL;

export const useModel = create<ModelStatus>(() => ({ state: 'idle', progress: 0, device: '', dtype: '', error: '', wrong: '' }));

interface Job {
  onChunk(text: string): void;
  /** failed: the model stopped on an error (it may have written part of the reply first) */
  onDone(failed: boolean): void;
}
const jobs = new Map<number, Job>();
let worker: Worker | null = null;
let nextId = 1;

function send(m: ToWorker) {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const r = e.data;
      if (r.type === 'status') useModel.setState(r.status);
      else if (r.type === 'prompt') console.log(`[loom] prompt ${r.id}, ${r.ids.length} tokens${r.templated ? '' : ' (no chat template: plain text)'}\n${r.text}`, r.ids);
      else if (r.type === 'chunk') jobs.get(r.id)?.onChunk(r.text);
      else {
        const job = jobs.get(r.id);
        jobs.delete(r.id);
        job?.onDone(r.failed);
      }
    };
    // the worker script itself failed: nothing in line will ever answer
    worker.onerror = (e) => {
      useModel.setState({ state: 'error', error: e.message || 'the model worker did not start' });
      const waiting = [...jobs.values()];
      jobs.clear();
      for (const j of waiting) j.onDone(true);
      worker?.terminate();
      worker = null;
    };
    worker.postMessage({ type: 'init', config: modelConfig } satisfies ToWorker);
  }
  worker.postMessage(m);
}

/** Where to go when the model fails its check: off 16-bit numbers first, then off the graphics card. null: nothing safer is left. */
export function saferAddress(m: ModelStatus): string | null {
  if (m.device !== 'webgpu') return null;
  const u = new URL(window.location.href);
  if (/16$/.test(m.dtype)) u.searchParams.set('dtype', 'q4');
  else {
    u.searchParams.set('device', 'wasm');
    u.searchParams.delete('dtype');
  }
  return u.toString();
}

/** Fetch and start the model now, ahead of the first message. */
export function loadModel() {
  send({ type: 'load' });
}

/** The model's continuation of the last turn, streamed. The model loads first if it has not yet. */
export function generate(turns: ChatTurn[], onChunk: (text: string) => void, onDone: (failed: boolean) => void): { cancel(): void } {
  const id = nextId++;
  jobs.set(id, { onChunk, onDone });
  send({ type: 'generate', id, turns });
  return {
    cancel() {
      if (jobs.delete(id)) send({ type: 'cancel', id });
    },
  };
}
