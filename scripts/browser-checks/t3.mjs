// T3: the model fails to load (weights blocked). What you type next must stay yours, not turn into the model's words.
import { open } from './lib.mjs';
const [url, outDir] = process.argv.slice(2);
const b = await open(url, outDir, { block: ['*.onnx', '*.onnx?*', '*.onnx_data*'] });
const chat = () => b.ev(`JSON.stringify(Object.values(__loom.getState().nodes).filter((n) => !n.isRoot).map((n) => n.messages.map((m) => m.role[0] + ':' + m.text + (m.generating ? ' (generating)' : ''))))`);
try {
  console.log('hello:', await b.say('hello'), '| pill:', JSON.stringify(await b.pill()), '| chat:', await chat());
  console.log('second message:', await b.say('are you there'), '| chat:', await chat());
  console.log('big downloads:', JSON.stringify(b.sizes.filter((s) => !s.includes('127.0.0.1'))), '| errors:', b.errors.length ? JSON.stringify(b.errors.slice(0, 4)) : 'none');
} catch (e) { console.log('DRIVER FAILED', e.message); } finally { b.close(); }
