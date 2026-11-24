/* The model, off the page's thread. transformers.js loads a small chat model (the weights come
   from Hugging Face into this browser's cache, never from our server) and streams one
   completion at a time; more requests wait in line. */
import { AutoModelForCausalLM, AutoTokenizer, InterruptableStoppingCriteria, TextStreamer, env } from '@huggingface/transformers';
import type { PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers';
import { buildPrompt } from './prompt';
import type { ChatTurn, FromWorker, ModelConfig, ModelStatus, ToWorker } from './protocol';

const ctx = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const post = (m: FromWorker) => ctx.postMessage(m);

env.allowLocalModels = false;

let config: ModelConfig = { model: '', temperature: 0.7, maxNewTokens: 320, check: false, debug: false };
let tokenizing: Promise<PreTrainedTokenizer> | null = null;
let model: PreTrainedModel | null = null;
let loading: Promise<void> | null = null;

const status: ModelStatus = { state: 'idle', progress: 0, device: '', dtype: '', error: '', wrong: '' };
const say = (patch: Partial<ModelStatus>) => {
  Object.assign(status, patch);
  post({ type: 'status', status: { ...status } });
};
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Gpu = { requestAdapter(): Promise<object | null> };

/** WebGPU when the browser has it, else WASM on the CPU. On WebGPU the 4-bit weights run with 32-bit
    numbers (q4): the smaller 16-bit file (q4f16) wrote nonsense on the first card it met. */
async function pickDevice(): Promise<{ device: 'webgpu' | 'wasm'; dtype: string }> {
  if (config.device !== 'wasm') {
    try {
      const adapter = await (navigator as unknown as { gpu?: Gpu }).gpu?.requestAdapter();
      if (adapter) return { device: 'webgpu', dtype: config.dtype ?? 'q4' };
    } catch {
      /* no usable adapter */
    }
    if (config.device === 'webgpu') throw new Error('this browser has no WebGPU');
  }
  return { device: 'wasm', dtype: config.dtype ?? 'q8' };
}

/** The tokenizer is small and comes first: a prompt can be built (and shown) before the weights are here. */
function loadTokenizer(): Promise<PreTrainedTokenizer> {
  tokenizing ??= AutoTokenizer.from_pretrained(config.model).catch((e) => {
    tokenizing = null;
    throw e;
  });
  return tokenizing;
}

const CHECK: ChatTurn[] = [
  { role: 'user', content: 'What is the capital of France?' },
  { role: 'assistant', content: '' },
];

/** One easy question, likeliest tokens only. '' when the answer names Paris, else what was said:
    a model whose numbers come out wrong still streams text, and nothing else would tell. */
async function misreads(tok: PreTrainedTokenizer, m: PreTrainedModel): Promise<string> {
  const prompt = buildPrompt(tok, CHECK);
  let said = '';
  const streamer = new TextStreamer(tok, { skip_prompt: true, skip_special_tokens: true, callback_function: (t: string) => void (said += t) });
  await m.generate({ ...tok(prompt.text, { add_special_tokens: !prompt.templated }), max_new_tokens: 16, do_sample: false, streamer });
  return /paris/i.test(said) ? '' : said.trim().slice(0, 80) || '(nothing)';
}

function load(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      say({ state: 'loading', progress: 0, error: '', wrong: '' });
      const { device, dtype } = await pickDevice();
      say({ device, dtype });
      const tok = await loadTokenizer();
      // the pill counts the weight files only
      const files = new Map<string, [number, number]>();
      let shown = 0;
      const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file || !p.total || !/\.onnx(_data)?$/.test(p.file)) return;
        files.set(p.file, [p.loaded ?? 0, p.total]);
        let got = 0;
        let all = 0;
        for (const [l, t] of files.values()) {
          got += l;
          all += t;
        }
        const pct = Math.floor((100 * got) / all);
        if (pct !== shown) say({ progress: (shown = pct) });
      };
      const opts = { device, dtype, progress_callback } as Parameters<typeof AutoModelForCausalLM.from_pretrained>[1];
      model = await AutoModelForCausalLM.from_pretrained(config.model, opts);
      const forward = model.forward.bind(model);
      model.forward = async (inputs) => {
        await breathe();
        return forward(inputs);
      };
      const wrong = config.check ? await misreads(tok, model) : '';
      say({ state: 'ready', progress: 100, wrong });
    })().catch((e) => {
      loading = null;
      model = null;
      say({ state: 'error', error: why(e) });
      throw e;
    });
  }
  return loading;
}

/* While it writes, the model's loop waits on nothing but the model, and on wasm that wait lets no
   message in: a "stop" would only be heard after the last word. So one is let in before each token. */
const tick = new MessageChannel();
const breathe = () =>
  new Promise<void>((done) => {
    tick.port1.onmessage = () => done();
    tick.port2.postMessage(0);
  });

interface Job {
  id: number;
  turns: ChatTurn[];
  cancelled: boolean;
}
const queue: Job[] = [];
let current: Job | null = null;
const stopper = new InterruptableStoppingCriteria();

async function run(job: Job) {
  const loaded = load();
  loaded.catch(() => {}); // it says so itself; the awaits below stop this reply
  const tokenizer = await loadTokenizer();
  const prompt = buildPrompt(tokenizer, job.turns, config.system);
  const inputs = tokenizer(prompt.text, { add_special_tokens: !prompt.templated });
  if (config.debug) post({ type: 'prompt', id: job.id, text: prompt.text, ids: Array.from(inputs.input_ids.data as BigInt64Array, Number), templated: prompt.templated });
  await loaded;
  if (job.cancelled || !model) return;
  if (status.error) say({ error: '' });
  let first = true;
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (first) {
        // the open turn lost its trailing spaces to the prompt and still has them on the page
        if (prompt.trimmed) text = text.replace(/^[ \t]+/, '');
        if (!text) return;
        first = false;
      }
      if (!job.cancelled) post({ type: 'chunk', id: job.id, text });
    },
  });
  stopper.reset();
  await model.generate({
    ...inputs,
    max_new_tokens: config.maxNewTokens,
    // asked to carry on a turn that reads as finished, the model would stop at once: make it say something
    min_new_tokens: prompt.continues ? 2 : 0,
    do_sample: config.temperature > 0,
    temperature: config.temperature > 0 ? config.temperature : 1,
    top_k: 20,
    repetition_penalty: 1.1,
    streamer,
    stopping_criteria: stopper,
  });
}

async function pump() {
  if (current) return;
  while ((current = queue.shift() ?? null)) {
    const job = current;
    let failed = false;
    try {
      await run(job);
    } catch (e) {
      failed = true;
      // a failed load has already said so
      if (status.state === 'ready') say({ error: why(e) });
    }
    post({ type: 'done', id: job.id, failed });
  }
}

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') config = m.config;
  else if (m.type === 'load') load().catch(() => {});
  else if (m.type === 'generate') {
    queue.push({ id: m.id, turns: m.turns, cancelled: false });
    void pump();
  } else if (m.type === 'cancel') {
    const waiting = queue.findIndex((j) => j.id === m.id);
    if (waiting >= 0) queue.splice(waiting, 1);
    else if (current?.id === m.id) {
      current.cancelled = true;
      stopper.interrupt();
    }
  }
};
