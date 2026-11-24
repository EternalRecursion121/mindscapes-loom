/* What the page and the model worker say to each other. */

export interface ModelConfig {
  /** a Hugging Face repo with ONNX weights; they go from Hugging Face straight into this browser */
  model: string;
  /** which weight file (q4f16, q4, q8, fp32...); left out, the worker picks one for the device */
  dtype?: string;
  /** left out: WebGPU when the browser has it, else WASM */
  device?: 'webgpu' | 'wasm';
  /** left out: the model's own default system prompt; 'none': no system turn; anything else: that text */
  system?: string;
  /** 0 = always the likeliest token */
  temperature: number;
  maxNewTokens: number;
  /** after loading, ask the model one easy question: some graphics cards run it and get the numbers wrong */
  check: boolean;
  /** send each prompt back to the page, as text and as token ids */
  debug: boolean;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  /** 0..100 while the weights download */
  progress: number;
  device: string;
  dtype: string;
  /** why loading failed, or why the last reply stopped short */
  error: string;
  /** the model loaded but failed its check: what it answered */
  wrong: string;
}

export type ToWorker =
  | { type: 'init'; config: ModelConfig }
  | { type: 'load' }
  | { type: 'generate'; id: number; turns: ChatTurn[] }
  | { type: 'cancel'; id: number };

export type FromWorker =
  | { type: 'status'; status: ModelStatus }
  | { type: 'prompt'; id: number; text: string; ids: number[]; templated: boolean }
  | { type: 'chunk'; id: number; text: string }
  | { type: 'done'; id: number; failed: boolean };
