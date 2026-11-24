// Forking at a word, the fork row under a long chat, and the ⋮ button and its menu in a narrow chat.
// usage: node words.mjs <page url with ?debug and a test model> <fresh out dir> [port]
import { open, sleep } from './lib.mjs';
const [url, outDir, port = '19411'] = process.argv.slice(2);
const MOUSE = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';
const b = await open(url, outDir, { port: Number(port), flags: [MOUSE], block: ['*Qwen2.5*', '*onnx-community*'] });
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); };
const J = JSON.stringify;
const rect = (sel, i = 0) => b.ev(`(() => { const e = [...document.querySelectorAll(${J(sel)})].at(${i}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
const move = async (x, y) => { await b.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(120); };
const click = async (x, y) => { await move(x, y); for (const type of ['mousePressed', 'mouseReleased']) await b.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(250); };
const clickOn = async (sel, i = 0) => { await b.ev(`[...document.querySelectorAll(${J(sel)})].at(${i})?.scrollIntoView({ block: 'center' })`); await sleep(200); const r = await rect(sel, i); if (!r) return false; await click(r.cx, r.cy); return true; };
const item = (start) => b.ev(`[...document.querySelectorAll('.node-menu button')].findIndex((e) => e.textContent.trim().startsWith(${J(start)}))`);
const menuItem = async (start) => { const i = await item(start); return i >= 0 && clickOn('.node-menu button', i); };
const hoverItem = async (start) => { const i = await item(start); if (i < 0) return false; const r = await rect('.node-menu button', i); await move(r.cx, r.cy); await sleep(250); return true; };
const key = async (k, code) => { for (const type of ['keyDown', 'keyUp']) await b.cdp('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code }); await sleep(150); };
const inWindow = (sel) => b.ev(`[...document.querySelectorAll(${J(sel)})].every((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })`);
const bubbles = () => b.ev(`[...document.querySelectorAll('.msgs .bubble')].map((e) => ({ role: e.classList.contains('user') ? 'user' : 'model', text: [...e.querySelectorAll('.tok')].map((t) => t.textContent).join(' '), gen: !!e.querySelector('.caret, .waiting') }))`);
const lastPrompt = () => b.ev(`__prompts.at(-1)?.text ?? ''`);
// until the model has been given a new prompt and has written words past `had` (the first time it also has to load)
const nPrompts = () => b.ev(`__prompts.length`);
const written = async (n0, had = 0, secs = 30) => { for (let i = 0; i < secs * 5; i++) { const l = (await bubbles()).at(-1); if ((await nPrompts()) > n0 && l?.gen && l.text.length > had) return true; await sleep(200); } return false; };
const LONG = Array.from({ length: 70 }, (_, i) => 'w' + i).join(' ');
const load = (head) => b.ev(`(() => {
  const s = __loom.getState();
  const nodes = { [s.rootId]: s.nodes[s.rootId] }, children = { [s.rootId]: ['a'], a: ['b1', 'b2', 'b3'], b1: [], b2: [], b3: [] };
  const end = { msg: 1, offset: ${LONG.length} };
  nodes.a = { id: 'a', parentId: s.rootId, forkAt: null, messages: [{ role: 'user', text: 'hello there friend' }, { role: 'model', text: ${J(LONG)} }], x: 0, y: 220, hidden: false };
  ['one first branch', 'two second branch', 'three third branch'].forEach((t, i) => { nodes['b' + (i + 1)] = { id: 'b' + (i + 1), parentId: 'a', forkAt: end, messages: [{ role: 'user', text: t }], x: i * 300, y: 440, hidden: false }; });
  __loom.setState({ nodes, children, structure: s.structure + 1 });
  const t = __loom.getState();
  __loom.setState({ tabs: t.tabs.map((x) => (x.id === t.activeTabId ? { ...x, headId: ${J(head)} } : x)) });
  t.resizeWindow(t.windows[0].id, 240);
})()`);
try {
  await b.cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 620, deviceScaleFactor: 2, mobile: false });
  await sleep(1500);
  // ---- 1. the fork row under a chat longer than its window
  await load('a');
  await sleep(500);
  const m = await b.ev(`(() => { const e = document.querySelector('.msgs'); return { sh: e.scrollHeight, ch: e.clientHeight, w: e.closest('.col')?.getBoundingClientRect().width }; })()`);
  check('chat is narrow and longer than its window', m.sh > m.ch + 100 && Math.round(m.w) === 240, J(m));
  await b.ev(`document.querySelector('.msgs').scrollTop = 1e6`);
  await sleep(300);
  const tree = await rect('.fork-tree');
  const boxes = await b.ev(`[...document.querySelectorAll('.fork-box')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.height), e.textContent]; })`);
  check('fork row has its full height', !!tree && tree.h >= 90, tree ? `row ${Math.round(tree.h)} px` : 'no row');
  check('three fork boxes, with their words', boxes.length === 3 && boxes.every(([h, t]) => h >= 60 && t.length > 8), J(boxes));
  await b.shot('1-fork-row');
  await clickOn('.fork-box', 1);
  check('a click on a box goes to that branch', (await bubbles()).at(-1)?.text === 'two second branch', J((await bubbles()).at(-1)));
  await load('a');
  await sleep(300);
  // ---- 2. the ⋮ button and its menu
  const d = await rect('.composer-dots');
  const round = await b.ev(`getComputedStyle(document.querySelector('.composer-dots')).borderRadius`);
  check('dots button is a 34 px circle, inside its chat', !!d && Math.round(d.w) === 34 && Math.round(d.h) === 34 && round === '50%' && d.x + d.w <= 240, d ? `${Math.round(d.x)},${Math.round(d.w)}x${Math.round(d.h)} ${round}` : '');
  await move(d.cx, d.cy);
  await b.shot('2-dots-hover');
  await clickOn('.composer-dots');
  const cm = await rect('.chat-menu');
  check('chat menu whole inside the window in a 240 px chat', !!cm && (await inWindow('.chat-menu')) && cm.x >= 8, cm ? `menu x ${Math.round(cm.x)}..${Math.round(cm.x + cm.w)}` : 'no menu');
  await hoverItem('your messages show up');
  check('its side menu inside the window', (await b.ev(`document.querySelectorAll('.node-menu').length`)) === 2 && (await inWindow('.node-menu')));
  await b.shot('2-chat-menu-narrow');
  await key('Escape', 27);
  // ---- 3. fork at a word of the assistant's message
  const WORD = 12; // tok index in the chat: 3 of hers, then w0…
  const word = await b.ev(`document.querySelectorAll('.msgs .tok')[${WORD}].textContent`);
  await b.ev(`document.querySelectorAll('.msgs .tok')[${WORD}].scrollIntoView({ block: 'center' })`);
  await sleep(200);
  const wr = await rect('.msgs .tok', WORD);
  await move(wr.cx, wr.cy);
  check('a word shows it can be clicked', (await b.ev(`getComputedStyle(document.querySelectorAll('.msgs .tok')[${WORD}]).cursor`)) === 'pointer');
  await sleep(900);
  check('word tooltip', (await b.ev(`document.querySelector('.tok-tip')?.textContent ?? ''`)) === 'click to fork at this word', J(await b.ev(`document.querySelector('.tok-tip')?.textContent ?? ''`)));
  await click(wr.cx, wr.cy);
  check('a click on a plain word opens the fork menu', (await item('new fork here')) >= 0 && (await item('view forks here')) >= 0);
  await hoverItem('new fork here');
  await b.shot('3-word-menu');
  const before = LONG.slice(0, LONG.indexOf(word + ' ')).trimEnd();
  let n0 = await nPrompts();
  await menuItem('generate 1 branch');
  check('model starts writing', await written(n0, before.length + 3));
  let p = await lastPrompt();
  check('the prompt ends in her message and the assistant text up to that word', p.trimEnd().endsWith(before) && p.includes('hello there friend') && !p.includes(word + ' '), J(p.slice(-60)));
  let bs = await bubbles();
  check('chat: her message, then one assistant bubble carrying on from the cut', bs.length === 2 && bs[1].role === 'model' && bs[1].text.startsWith(before.split(' ').join(' ')) && bs[1].text.length > before.length, J(bs.map((x) => [x.role, x.text.slice(0, 30), x.gen])));
  await clickOn('.send.stop');
  await sleep(400);
  const lit = await b.ev(`[...document.querySelectorAll('.msgs .tok.loomed')].map((e) => [e.dataset.b, e.previousElementSibling?.textContent])`);
  check('one lit word, right after the cut, counting the old continuation', lit.length === 1 && lit[0][0] === '1' && lit[0][1] === before.split(' ').at(-1), J(lit));
  await clickOn('.msgs .tok.loomed');
  await hoverItem('view forks here');
  const list = await b.ev(`[...document.querySelectorAll('.node-menu .fork-pick')].map((e) => e.textContent)`);
  check('its list has the old continuation', list.length === 1 && list[0].startsWith(word + ' '), J(list));
  await menuItem(word);
  bs = await bubbles();
  check('picking it shows the old message whole again', bs.length === 2 && bs[1].text === LONG, J(bs.map((x) => x.text.length)));
  // ---- 4. fork at a word of her message
  await load('a');
  await sleep(300);
  await clickOn('.msgs .tok', 2); // "friend"
  await hoverItem('new fork here');
  n0 = await nPrompts();
  await menuItem('generate 1 branch');
  await written(n0, 0);
  p = await lastPrompt();
  bs = await bubbles();
  check('cut in her message: the assistant answers the cut text', bs.length === 2 && bs[0].role === 'user' && bs[0].text === 'hello there' && bs[1].role === 'model' && p.includes('hello there') && !p.includes('friend'), J([bs.map((x) => [x.role, x.text.slice(0, 20)]), p.slice(-40)]));
  await clickOn('.send.stop');
  // ---- 5. the first word of a bubble
  await load('a');
  await sleep(300);
  await clickOn('.msgs .tok', 3); // w0
  check('first word of a bubble opens the menu too', (await item('new fork here')) >= 0);
  await key('Escape', 27);
  // ---- 6. robot buttons: the voice that spoke last has 70% of the chat's width
  await clickOn('.composer-dots');
  await clickOn('.switch'); // auto-prompt off
  await key('Escape', 27);
  const sideAt = async (f) => { const r = await rect('.msgs'); await move(r.x + r.w * f, r.y + 30); return b.ev(`document.querySelector('.msgs').dataset.side`); };
  let sides = [await sideAt(0.1), await sideAt(0.65), await sideAt(0.75), await sideAt(0.95)];
  check('assistant spoke last: left side is 70%', sides.join() === 'left,left,right,right', sides.join());
  await clickOn('.fork-box', 0); // a branch that ends in her message
  sides = [await sideAt(0.1), await sideAt(0.25), await sideAt(0.35), await sideAt(0.95)];
  check('she spoke last: right side is 70%', sides.join() === 'left,left,right,right', sides.join());
  const rb = await b.ev(`(() => { const e = document.querySelector('.msgs .robot-btn'); const c = getComputedStyle(e); return [e.getBoundingClientRect().height, c.borderRadius]; })()`);
  check('robot button is a 30 px full pill', rb[0] === 30 && parseFloat(rb[1]) >= 15, J(rb));
  await clickOn('.composer-dots');
  await clickOn('.switch');
  await key('Escape', 27);
  check('no page errors', b.errors.length === 0, J(b.errors.slice(0, 3)));
} finally {
  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  b.close();
}
