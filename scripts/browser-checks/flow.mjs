// The real steps, by clicks: say hello, fork at the gap between "hello" and the reply ("new fork here" > "write the
// next message"), type a new message. You spoke last ("hello"), so the new text joins that message: the two
// branches part inside one bubble, at the first new word. One fork was made, so the chat must show one mark, there,
// and it must list the branch that was left (the reply).
// usage: node flow.mjs <page url with ?debug and a test model> <out dir> [port]
import { open } from './lib.mjs';
const [url, outDir, port] = process.argv.slice(2);
const b = await open(url, outDir, { port: port ? Number(port) : undefined, block: ['*Qwen2.5*', '*onnx-community*'] });
const wait = () => new Promise((r) => setTimeout(r, 400));
const marks = () => b.ev(`[...document.querySelectorAll('.msgs .loomed')].map((e) => (e.classList.contains('gap') ? 'gap x' : 'word ' + e.textContent + ' x') + e.dataset.b)`);
const press = async (start) => { const ok = await b.ev(`(() => { const x = [...document.querySelectorAll('.node-menu button')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(start)})); if (!x) return false; x.click(); return true; })()`); await wait(); return ok; };
const gap = async (i) => { await b.ev(`document.querySelectorAll('.msgs .gap')[${i}].click()`); await wait(); };
try {
  console.log('hello:', await b.say('hello'), '| pill:', JSON.stringify(await b.pill()));
  console.log('bubbles:', await b.ev(`document.querySelectorAll('.msgs .bubble').length`), '| marks before the fork:', JSON.stringify(await marks()));
  await gap(1);
  console.log('menu:', (await press('new fork')) && (await press('write the next message')) ? 'forked between hello and the reply' : 'NOT FOUND');
  console.log('marks before typing:', JSON.stringify(await marks()));
  console.log('new message:', await b.say('what is the capital of france'));
  const m = await marks();
  await b.ev(`document.querySelector('.msgs .loomed')?.click()`);
  await wait();
  await press('view forks here'); // a word opens the whole fork menu: its branches are one step in
  const list = await b.ev(`[...document.querySelectorAll('.node-menu .fork-pick')].map((e) => e.textContent.trim())`);
  await b.shot('flow');
  console.log('marks after:', JSON.stringify(m), '| it lists:', JSON.stringify(list), '| errors:', b.errors.length ? JSON.stringify(b.errors.slice(0, 3)) : 'none');
  console.log(m.length === 1 && m[0] === 'word what x1' && list.length === 1 ? 'PASS: one fork, one mark, one branch in its list' : `FAILED: ${m.length} marks, ${list.length} in the list`);
} catch (e) { console.log('DRIVER FAILED', e.message); } finally { b.close(); }
