// T1: the real tokenizer and chat template of the default model, in the real built page, with no weights:
// ?dtype=nope makes the model load fail before any weight request, and weight files are blocked besides.
// Megan's steps are replayed; the prompts the worker builds (?debug) are written to <out>/prompts.json.
import { writeFileSync } from 'node:fs';
import { open, sleep } from './lib.mjs';
const [url, outDir, port = '19333', ...flags] = process.argv.slice(2);
const b = await open(url, outDir, { port: Number(port), flags, block: ['*.onnx', '*.onnx?*', '*.onnx_data*'] });
const L = '__loom.getState()';
// the model cannot answer here (no weights), so its replies are put in by hand: Megan's screenshot gives their words
const setLast = (text) => b.ev(`(() => { const s = ${L}; const id = s.tabs.find((t) => t.id === s.activeTabId).headId; const n = s.nodes[id]; const last = n.messages[n.messages.length - 1]; const ms = last.role === 'model' ? [...n.messages.slice(0, -1), { role: 'model', text: ${JSON.stringify(text)} }] : [...n.messages, { role: 'model', text: ${JSON.stringify(text)} }]; __loom.setState({ nodes: { ...s.nodes, [id]: { ...n, messages: ms } } }); return id; })()`);
try {
  console.log('gpu:', await b.ev(`(async () => { try { return (await navigator.gpu?.requestAdapter()) ? 'adapter' : 'none'; } catch (e) { return 'err'; } })()`));
  console.log('hello:', await b.say('hello'), '| pill:', await b.pill());
  console.log('after the failed reply the chat holds:', await b.ev(`JSON.stringify(Object.values(${L}.nodes).filter((n) => !n.isRoot).map((n) => n.messages.map((m) => m.role[0] + ':' + m.text)))`));
  const first = await setLast("You're asking theERNUIOUIUIUIUI/UI/UI/UI");
  await b.ev(`${L}.forkAtPoint(${L}.activeTabId, ${JSON.stringify(first)}, 1, 13, 'write')`);
  await sleep(300);
  for (const q of ['what is the capital of france', 'how can i know things', 'say something please?']) {
    console.log(q, ':', await b.say(q));
    await setLast('To ask a question');
  }
  // the other kind of fork: the model writes on from "You're asking"
  await b.ev(`${L}.forkAtPoint(${L}.activeTabId, ${JSON.stringify(first)}, 1, 13, 'generate')`);
  await sleep(300); await b.settle();
  await sleep(500);
  const prompts = await b.ev('JSON.stringify(__prompts)');
  writeFileSync(`${outDir}/prompts.json`, prompts);
  console.log('prompts caught:', JSON.parse(prompts).length);
  console.log('tree:', await b.ev(`JSON.stringify(Object.values(${L}.nodes).filter((n) => !n.isRoot).map((n) => [n.messages.length, n.forkAt && [n.forkAt.msg, n.forkAt.offset], n.messages.map((m) => m.role[0] + ':' + m.text.slice(0, 22))]))`));
  await b.shot('t1');
  const hf = b.requests.filter((u) => !u.includes('127.0.0.1'));
  console.log('outside requests:', JSON.stringify([...new Set(hf.map((u) => u.split('/').slice(2).join('/').replace(/resolve\/main\//, '').slice(0, 80)))]));
  const asked = hf.filter((u) => /onnx/.test(u.split('/').pop()));
  console.log('weight files asked for:', JSON.stringify([...new Set(asked.map((u) => u.split('/').pop()))]), 'x' + asked.length, '| stopped by the test:', b.failed.filter((f) => f.startsWith('inspector')).length);
  console.log('downloads over 0.2 MB:', JSON.stringify(b.sizes));
  console.log('pill states:', JSON.stringify(b.seen));
  console.log('errors:', b.errors.length ? JSON.stringify(b.errors.slice(0, 6)) : 'none');
} catch (e) { console.log('DRIVER FAILED', e.message); } finally { b.close(); }
