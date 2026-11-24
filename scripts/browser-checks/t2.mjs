// T2: Megan's fork steps end to end on a tiny random model in Qwen's format (weights are random noise, 5 MB):
// one fork, three different messages. Do three sends give three replies of their own, and does the chat show each once?
// node t2.mjs <page url with query> <out dir> [port] [chrome flags...]
import { writeFileSync } from 'node:fs';
import { open, sleep } from './lib.mjs';
const [url, outDir, port = '19333', ...flags] = process.argv.slice(2);
const b = await open(url, outDir, { port: Number(port), flags });
const L = '__loom.getState()';
const head = () => b.ev(`(() => { const s = ${L}; return s.tabs.find((t) => t.id === s.activeTabId).headId; })()`);
const lastText = () => b.ev(`(() => { const s = ${L}; const n = s.nodes[s.tabs.find((t) => t.id === s.activeTabId).headId]; return n.messages[n.messages.length - 1].text; })()`);
try {
  console.log('gpu:', await b.ev(`(async () => { try { const a = await navigator.gpu?.requestAdapter(); return a ? 'adapter, f16=' + a.features.has('shader-f16') : 'none'; } catch (e) { return 'err ' + e.message; } })()`));
  console.log('hello:', await b.say('hello'), '| pill:', JSON.stringify(await b.pill()), '| title:', JSON.stringify((await b.ev(`document.querySelector('.model-pill').title`)).slice(0, 160)));
  const first = await head();
  const r0 = await lastText();
  console.log('reply 0:', JSON.stringify(r0.slice(0, 70)), 'len', r0.length);
  const cut = Math.min(6, Math.max(1, r0.length - 1));
  await b.ev(`${L}.forkAtPoint(${L}.activeTabId, ${JSON.stringify(first)}, 1, ${cut}, 'write')`);
  await sleep(300);
  const replies = [];
  for (const q of ['what is the capital of france', 'how can i know things', 'say something please?']) {
    const t = await b.say(q);
    replies.push(await lastText());
    console.log(q, ':', t, '->', JSON.stringify(replies.at(-1).slice(0, 60)));
  }
  console.log('three replies all different:', new Set(replies).size === 3, '| none empty:', replies.every((r) => r.length > 0));
  // what the chat itself shows: one bubble per message, in order
  const bubbles = await b.ev(`JSON.stringify([...document.querySelectorAll('.sidebar [class*="bubble"], [class*="chat"] [class*="bubble"]')].map((e) => e.innerText.slice(0, 28)))`);
  console.log('bubbles in the chat:', bubbles);
  console.log('tree:', await b.ev(`JSON.stringify(Object.values(${L}.nodes).filter((n) => !n.isRoot).map((n) => [n.messages.length + ' msgs', n.forkAt && [n.forkAt.msg, n.forkAt.offset]]))`));
  const prompts = JSON.parse(await b.ev('JSON.stringify(__prompts)'));
  writeFileSync(`${outDir}/prompts.json`, JSON.stringify(prompts));
  console.log('prompts:', prompts.length, '| last one ends:', JSON.stringify(prompts.at(-1)?.text.slice(-120)));
  await b.shot('t2');
  console.log('downloads over 0.2 MB:', JSON.stringify(b.sizes.filter((s) => !s.includes('127.0.0.1'))));
  console.log('pill states:', JSON.stringify(b.seen));
  console.log('errors:', b.errors.length ? JSON.stringify(b.errors.slice(0, 6)) : 'none');
} catch (e) { console.log('DRIVER FAILED', e.message); } finally { b.close(); }
