// The live page, weights blocked: what the pill says before anything is sent, and which weight file it would fetch.
import { open } from './lib.mjs';
const [url, outDir, port = '19333', ...flags] = process.argv.slice(2);
const b = await open(url, outDir, { port: Number(port), flags, block: ['*.onnx', '*.onnx?*', '*.onnx_data*'] });
try {
  console.log('pill before anything:', JSON.stringify(await b.pill()));
  console.log('hello:', await b.say('hello'), '| pill:', JSON.stringify(await b.pill()));
  const w = b.requests.filter((u) => /\.onnx(_data)?$/.test(u.split('?')[0]));
  console.log('weight file it went for:', JSON.stringify([...new Set(w.map((u) => u.split('/').pop()))]), '| stopped by the test:', b.failed.filter((f) => f.startsWith('inspector')).length, 'of', w.length);
  console.log('downloads over 0.2 MB from outside:', JSON.stringify(b.sizes.filter((s) => !s.includes('mains.in.net'))), '| errors:', b.errors.length ? JSON.stringify(b.errors.slice(0, 3)) : 'none');
} catch (e) { console.log('DRIVER FAILED', e.message); } finally { b.close(); }
