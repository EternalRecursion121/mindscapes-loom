import { isDefaultModel, loadModel, modelConfig, saferAddress, useModel } from './client';

/** The in-browser model's state. A click fetches the weights ahead of the first message (the first send does it too). */
export function ModelPill() {
  const m = useModel();
  const name = modelConfig.model.split('/').pop() ?? modelConfig.model;
  const safer = m.wrong ? saferAddress(m) : null;
  let text: string;
  let title: string;
  if (m.error) {
    text = m.state === 'error' ? 'model did not load' : 'model stopped';
    title = `${m.error}\nClick to try again.${m.device === 'webgpu' ? ' Adding ?device=wasm to the address runs it on the CPU: slow, but it needs no graphics card.' : ''}`;
  } else if (m.state === 'idle') {
    text = isDefaultModel ? 'load model · up to 790 MB, once' : 'load model';
    title = `${modelConfig.model} runs in this browser. Its weights download from Hugging Face the first time and are kept by the browser after that.`;
  } else if (m.state === 'loading') {
    text = m.progress > 0 && m.progress < 100 ? `loading model ${m.progress}%` : 'starting model…';
    title = `${modelConfig.model}${m.dtype ? `, ${m.dtype}` : ''}`;
  } else if (m.wrong) {
    text = `model reads wrong · ${m.device} ${m.dtype}`;
    title =
      `Asked for the capital of France, it said: ${m.wrong}\n` +
      (safer
        ? `Click to load ${/16$/.test(m.dtype) ? 'the weights that run with 32-bit numbers (about 790 MB)' : 'it on the CPU instead (about 510 MB, slow)'}.`
        : 'It is already on the CPU, so the card is not the cause.');
  } else {
    text = `${name} · ${m.device} ${m.dtype}${m.device === 'wasm' ? ' (slow)' : ''}`;
    title = `${modelConfig.model}, running in this browser${m.device === 'wasm' ? ' on the CPU: a browser with WebGPU is much faster' : ''}`;
  }
  const click = safer ? () => window.location.assign(safer) : loadModel;
  return (
    <button className={`model-pill ${m.error || m.wrong ? 'error' : m.state}`} onClick={click} disabled={m.state === 'loading'} title={title}>
      <span className="model-dot" aria-hidden="true" />
      <span className="model-text">{text}</span>
    </button>
  );
}
