// The typing + forking interface, by real mouse moves, clicks and keys, on a test model.
// usage: node ui.mjs <page url with ?debug and a test model> <out dir> [port]
import { open, sleep } from './lib.mjs';
const [url, outDir, port] = process.argv.slice(2);
// headless Chrome says it has no mouse; the page shows hover-only things at all times then
const MOUSE = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';
const b = await open(url, outDir, { port: port ? Number(port) : undefined, flags: [MOUSE], block: ['*Qwen2.5*', '*onnx-community*'] });
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`); };
const J = JSON.stringify;
const rect = (sel, i = 0) => b.ev(`(() => { const e = [...document.querySelectorAll(${J(sel)})].at(${i}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
const move = async (x, y) => { await b.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(120); };
const click = async (x, y) => { await move(x, y); for (const type of ['mousePressed', 'mouseReleased']) await b.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(250); };
const clickOn = async (sel, i = 0) => { const r = await rect(sel, i); if (!r) return false; await click(r.cx, r.cy); return true; };
// a gap may be scrolled out of sight in a long chat
const gapClick = async (i) => { await b.ev(`[...document.querySelectorAll('.msgs .gap')].at(${i}).scrollIntoView({ block: 'center' })`); await sleep(250); const r = await rect('.msgs .gap', i); if (!r) return false; for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await b.cdp('Input.dispatchMouseEvent', { type, x: r.cx, y: r.cy, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }); await sleep(250); return true; };
const key = async (k, code) => { for (const type of ['keyDown', 'keyUp']) await b.cdp('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code }); await sleep(150); };
const type = async (text) => { await b.ev(`document.querySelector('textarea[aria-label="Message this thread"]').focus()`); await b.cdp('Input.insertText', { text }); await key('Enter', 13); await sleep(250); };
const bubbles = () => b.ev(`[...document.querySelectorAll('.msgs .bubble')].map((e) => ({ role: e.classList.contains('user') ? 'user' : 'model', text: [...e.querySelector('p').childNodes].filter((n) => n.nodeType === 3 || n.classList?.contains('tok')).map((n) => n.textContent).join(''), gen: !!e.querySelector('.caret, .waiting') }))`);
const menuItem = async (start) => { const i = await b.ev(`[...document.querySelectorAll('.node-menu button')].findIndex((e) => e.textContent.trim().startsWith(${J(start)}))`); if (i < 0) return false; return clickOn('.node-menu button', i); };
const hoverItem = async (start) => { const i = await b.ev(`[...document.querySelectorAll('.node-menu button')].findIndex((e) => e.textContent.trim().startsWith(${J(start)}))`); if (i < 0) return false; const r = await rect('.node-menu button', i); await move(r.cx, r.cy); await sleep(200); return true; };
const inWindow = (sel) => b.ev(`[...document.querySelectorAll(${J(sel)})].every((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })`);
// until the message being written has words (the first reply also waits for the model to load)
const writing = async (secs = 20) => { for (let i = 0; i < secs * 5; i++) { const l = (await bubbles()).at(-1); if (l?.gen && l.text.length > 0) return true; await sleep(200); } return false; };
const lastPrompt = () => b.ev(`__prompts.at(-1)?.text ?? ''`);
const placeholder = () => b.ev(`document.querySelector('.composer textarea').placeholder`);
const opacity = (sel) => b.ev(`[...document.querySelectorAll(${J(sel)})].map((e) => getComputedStyle(e).opacity).join(',')`);
const setPref = async (what) => {
  // through the ⋮ menu, as she would
  if (!(await b.ev(`!!document.querySelector('.chat-menu')`))) await clickOn('.composer-dots');
  if (what === 'auto-on' || what === 'auto-off') {
    const on = await b.ev(`document.querySelector('.switch').getAttribute('aria-checked') === 'true'`);
    if (on !== (what === 'auto-on')) await clickOn('.switch');
  } else {
    await hoverItem('your messages show up');
    await menuItem(what);
  }
  await key('Escape', 27);
};
try {
  // ---- 1. the box
  await sleep(1500);
  check('placeholder', (await placeholder()) === 'send a new user message', await placeholder());
  check('no + button, no tags', await b.ev(`!document.querySelector('.composer-plus, .tag')`));
  // ---- 2. send, look around while it writes, stop
  await type('hello');
  await writing();
  let bs = await bubbles();
  check('reply is being written', bs.length === 2 && bs[1].gen, J(bs.map((x) => [x.role, x.text.length, x.gen])));
  check('send button is a stop button', await b.ev(`!!document.querySelector('.send.stop') && !document.querySelector('.send[type=submit]')`));
  console.log('     first prompt:', J(await lastPrompt()));
  await gapClick(1);
  const len1 = (await bubbles())[1].text.length;
  await hoverItem('new fork here');
  await b.shot('1-menu-while-writing');
  await sleep(1500);
  bs = await bubbles();
  check('gap menu stays open while text streams', (await b.ev(`document.querySelectorAll('.node-menu').length`)) >= 1 && bs[1].text.length > len1 && bs[1].gen, `text ${len1} -> ${bs[1].text.length}`);
  check('gap menu and its submenu inside the window', await inWindow('.node-menu'));
  await key('Escape', 27);
  await clickOn('.send.stop');
  bs = await bubbles();
  const kept = bs[1].text.length;
  await sleep(1200);
  bs = await bubbles();
  check('stop halts and keeps the words', !bs[1].gen && kept > 0 && bs[1].text.length === kept && !(await b.busy()), `${kept} chars kept`);
  check('stop button is a send button again', await b.ev(`!!document.querySelector('.send[type=submit]') && !document.querySelector('.send.stop')`));
  // ---- 3. the ⋮ menu
  await clickOn('.composer-dots');
  const m = await rect('.chat-menu'), d = await rect('.composer-dots');
  check('menu opens above the dots, inside the window', !!m && m.y + m.h <= d.y && (await inWindow('.chat-menu')), m ? `menu ${Math.round(m.x)},${Math.round(m.y)} ${Math.round(m.w)}x${Math.round(m.h)}` : 'no menu');
  check('menu rows', await b.ev(`document.querySelector('.chat-menu').innerText.replace(/\\s+/g, ' ')`).then((t) => /auto-prompt model when you send a message/.test(t) && /your messages show up as the: ?USER/i.test(t)), J(await b.ev(`document.querySelector('.chat-menu').innerText.replace(/\\s+/g, ' ')`)));
  const sw = () => b.ev(`(() => { const e = document.querySelector('.switch'); const k = e.querySelector('.knob').getBoundingClientRect(), r = e.getBoundingClientRect(); return { on: e.getAttribute('aria-checked'), bg: getComputedStyle(e).backgroundColor, knobRight: k.x + k.width / 2 > r.x + r.width / 2 }; })()`);
  const on = await sw();
  await b.shot('2-chat-menu');
  await clickOn('.switch');
  await sleep(250);
  const off = await sw();
  check('switch: on = green, knob right; off = black, knob left', on.on === 'true' && on.knobRight && on.bg !== 'rgb(0, 0, 0)' && off.on === 'false' && !off.knobRight && off.bg === 'rgb(0, 0, 0)', J([on, off]));
  await hoverItem('your messages show up');
  check('voice submenu: user ✓ / assistant / alternate, inside the window', (await b.ev(`[...document.querySelectorAll('.node-menu.sub button')].map((e) => e.textContent.trim()).join('|')`)) === 'user✓|assistant|alternate' && (await inWindow('.node-menu.sub')));
  await b.shot('3-voice-submenu');
  await menuItem('assistant');
  await key('Escape', 27);
  check('typing as the assistant: placeholder', (await placeholder()) === 'send a new assistant message', await placeholder());
  // ---- 4. one voice never twice in a row
  check('hint says it joins', (await b.ev(`document.querySelector('.composer-hint')?.textContent ?? ''`)) === 'this adds to the assistant message above');
  await type('ZZZ');
  bs = await bubbles();
  check('assistant text joins the assistant bubble, no reply (auto off)', bs.length === 2 && /\sZZZ$/.test(bs[1].text) && !(await b.busy()), J(bs[1].text.slice(-12)));
  await setPref('user');
  await type('one');
  await type('two');
  bs = await bubbles();
  check('two user messages are one bubble', bs.length === 3 && bs[2].role === 'user' && bs[2].text === 'one\ntwo', J(bs.map((x) => [x.role, x.text.slice(-10)])));
  check('store holds one message for them', await b.ev(`(() => { const s = __loom.getState(); const n = s.nodes[s.tabs[0].headId]; return n.messages.length === 3 && n.messages[2].text === 'one\\ntwo'; })()`));
  // ---- 5. robot buttons (auto off)
  const mr = await rect('.msgs');
  const snap = () => b.ev(`(() => { const e = document.querySelector('.msgs'); const l = [...e.querySelectorAll('.bubble')].at(-1).getBoundingClientRect(); return [e.scrollHeight, e.scrollTop, Math.round(l.y), Math.round(l.height)].join(','); })()`);
  await move(mr.x + mr.w + 40, mr.y + 50);
  const before = await snap();
  const o0 = await opacity('.msgs .robot-btn');
  await move(mr.x + 40, mr.y + 60);
  const oL = [await opacity('.msgs .robot-btn.left'), await opacity('.msgs .robot-btn.right')], sL = await snap();
  await b.shot('4-robot-left');
  await move(mr.x + mr.w - 40, mr.y + 60);
  const oR = [await opacity('.msgs .robot-btn.left'), await opacity('.msgs .robot-btn.right')], sR = await snap();
  await b.shot('5-robot-right');
  check('robot buttons: hidden away from the chat, left half shows the assistant one, right half the user one', /^0(,0)*$/.test(o0) && oL.join() === '1,0' && oR.join() === '0,1', J([o0, oL, oR]));
  check('nothing moves when they appear', before === sL && sL === sR, J([before, sL, sR]));
  check('user spoke last: inline button in the user bubble, ghost on the assistant side', await b.ev(`(() => { const i = document.querySelector('.bubble:last-of-type .robot-btn') ?? [...document.querySelectorAll('.bubble')].at(-1).querySelector('.robot-btn'); const g = [...document.querySelectorAll('.ghost-row .robot-btn')]; return i?.dataset.voice === 'user' && g.length === 1 && g[0].dataset.voice === 'model'; })()`));
  const g = await rect('.ghost-row .robot-btn');
  await move(g.cx, g.cy);
  await sleep(1300);
  check('tooltip', (await b.ev(`document.querySelector('.tok-tip')?.textContent ?? ''`)) === 'click to start model response as the assistant', J(await b.ev(`document.querySelector('.tok-tip')?.textContent ?? ''`)));
  await b.shot('6-robot-tip');
  await click(g.cx, g.cy);
  await writing();
  bs = await bubbles();
  let p = await lastPrompt();
  check('ghost button: the model answers as the assistant', bs.length === 4 && bs[3].role === 'model' && bs[3].gen, J(bs.map((x) => [x.role, x.gen])));
  check('prompt: joined turns, no tokens between them', p.endsWith('ZZZ </s><s>[INST] one\ntwo [/INST] ') && p.split('[INST]').length === 3, J(p.slice(-110)));
  check('robot buttons are off while it writes', await b.ev(`[...document.querySelectorAll('.msgs .robot-btn')].every((e) => e.disabled && getComputedStyle(e).opacity === '0')`));
  await clickOn('.send.stop');
  bs = await bubbles();
  check('model spoke last: inline button in its bubble, ghost on the user side', await b.ev(`(() => { const i = [...document.querySelectorAll('.bubble')].at(-1).querySelector('.robot-btn'); const g = [...document.querySelectorAll('.ghost-row .robot-btn')]; return i?.dataset.voice === 'model' && g.length === 1 && g[0].dataset.voice === 'user'; })()`));
  const g2 = await rect('.ghost-row .robot-btn');
  await move(g2.cx, g2.cy);
  await sleep(1300);
  const tip2 = await b.ev(`document.querySelector('.tok-tip')?.textContent ?? ''`);
  await click(g2.cx, g2.cy);
  await writing();
  bs = await bubbles();
  p = await lastPrompt();
  check('ghost button on the user side: the model writes as the user', tip2 === 'click to start model response as the user' && bs.length === 5 && bs[4].role === 'user' && bs[4].gen && p.endsWith(' </s><s>[INST] ') && p.split('[INST]').length === 4, J([tip2, p.slice(-40)]));
  await clickOn('.send.stop');
  const before5 = (await bubbles())[4].text;
  await clickOn('.bubble.user .robot-btn', -1);
  await sleep(900);
  bs = await bubbles();
  p = await lastPrompt();
  check('inline button: the model carries the last message on', bs.length === 5 && bs[4].gen && bs[4].text.length > before5.length && bs[4].text.startsWith(before5) && p.endsWith(before5.trimEnd()) && p.split('[INST]').length === 4 && before5.length > 0, J(p.slice(-60)));
  await clickOn('.send.stop');
  // ---- 6. ask for more elsewhere: it queues; the fork list
  const t0 = (await bubbles()).length;
  await gapClick(1); // under the first message
  await hoverItem('new fork here');
  await menuItem('generate 3 branches');
  await sleep(1500);
  const q = await b.ev(`(() => { const s = __loom.getState(); return { order: s.streamOrder.length, texts: s.streamOrder.map((k) => { const [id, m] = k.split(':'); return s.nodes[id].messages[m].text.length; }), roles: s.streamOrder.map((k) => { const [id, m] = k.split(':'); return s.nodes[id].messages[m].role; }) }; })()`);
  check('3 branches asked for: one is written, two wait', q.order === 3 && q.texts[0] > 0 && q.texts[1] === 0 && q.texts[2] === 0 && q.roles.every((r) => r === 'model'), J(q));
  check('the chat shows "waiting for its turn"', (await b.ev(`document.querySelector('.msgs .waiting')?.textContent ?? ''`)) === 'waiting for its turn…');
  await b.shot('7-waiting');
  // look around meanwhile: the lit gap lists the other branches
  const lit = await b.ev(`[...document.querySelectorAll('.msgs .gap')].map((e) => e.classList.contains('loomed') ? Number(e.dataset.b) : 0)`);
  check('one fork point, one lit gap (3 other branches)', lit.filter(Boolean).length === 1 && lit[1] === 3, J(lit));
  await gapClick(1);
  await hoverItem('view forks here');
  await sleep(200);
  let list = await b.ev(`[...document.querySelectorAll('.node-menu.sub .fork-pick')].map((e) => e.textContent)`);
  check('fork list while they are written: 3 rows, inside the window', list.length === 3 && (await inWindow('.node-menu.sub')), J(list));
  await b.shot('8-fork-list-writing');
  await menuItem(list[0].slice(0, 12));
  await sleep(600);
  bs = await bubbles();
  check('picked a branch: the chat goes there (the old path), nothing is lost', bs.length === t0 && !bs.some((x) => x.gen), J(bs.map((x) => [x.role, x.text.length])));
  const done = await b.settle(120);
  await sleep(700);
  await gapClick(1);
  await hoverItem('view forks here');
  await sleep(200);
  list = await b.ev(`[...document.querySelectorAll('.node-menu.sub .fork-pick')].map((e) => e.textContent)`);
  check('fork list after they finish: 3 rows with their words', list.length === 3 && list.every((t) => !t.startsWith('(')), `${done} | ${J(list)}`);
  await b.shot('9-fork-list-done');
  await menuItem(list[2].slice(0, 12));
  await sleep(500);
  bs = await bubbles();
  check('went to a generated branch', bs.length === 2 && bs[1].role === 'model' && bs[1].text.length > 20, J(bs.map((x) => [x.role, x.text.length])));
  // ---- 7. fork above a message that is being written
  await setPref('auto-on');
  await type('again');
  await writing();
  bs = await bubbles();
  check('auto on: a user message gets a reply', bs.length === 4 && bs[3].gen, J(bs.map((x) => [x.role, x.gen])));
  const nGap = await b.ev(`document.querySelectorAll('.msgs .gap').length`);
  await gapClick(nGap - 1); // between "again" and the reply being written
  await hoverItem('new fork here');
  await menuItem('write the next message');
  await sleep(600);
  const st = await b.ev(`(() => { const s = __loom.getState(); const [id, m] = s.streamOrder[0].split(':'); return { order: s.streamOrder.length, len: s.nodes[id].messages[m].text.length, gen: !!s.nodes[id].messages[m].generating, headEmpty: s.nodes[s.tabs[0].headId].messages.length === 0 }; })()`);
  await sleep(1200);
  const st2 = await b.ev(`(() => { const s = __loom.getState(); const k = s.streamOrder[0]; if (!k) return { len: -1 }; const [id, m] = k.split(':'); return { len: s.nodes[id].messages[m].text.length }; })()`);
  check('forked above a message being written: it keeps getting its words', st.order === 1 && st.gen && st.headEmpty && st2.len > st.len, J([st, st2]));
  check('placeholder in the new empty branch', (await placeholder()) === 'send a new user message' && (await b.ev(`document.querySelector('.composer-hint')?.textContent ?? ''`)) === 'this adds to the user message above');
  await b.settle(60);
  // ---- 8. alternate
  await setPref('auto-off');
  await setPref('alternate');
  const ph1 = await placeholder();
  await type('as the other voice');
  bs = await bubbles();
  const ph2 = await placeholder();
  check('alternate: the voice that did not speak last, then the other', ph1 === 'send a new assistant message' && bs.at(-1).role === 'model' && bs.at(-1).text === 'as the other voice' && ph2 === 'send a new user message', J([ph1, ph2]));
  // ---- 9. an empty chat: the model may speak first
  await b.ev(`(() => { const s = __loom.getState(); s.goToNode(s.tabs[0].id, s.rootId); })()`);
  await sleep(500);
  check('empty chat: both ghost buttons', (await b.ev(`[...document.querySelectorAll('.ghost-row .robot-btn')].map((e) => e.dataset.voice).join()`)) === 'model,user' && (await bubbles()).length === 0);
  await b.shot('10-empty-chat');
  await clickOn('.ghost-row .robot-btn', 0);
  await writing();
  bs = await bubbles();
  p = await lastPrompt();
  check('the model speaks first, as the assistant (the test model wants the user first: plain text)', bs.length === 1 && bs[0].role === 'model' && p === '', J(p));
  await clickOn('.send.stop');
  // ---- 10. the top gap
  await gapClick(0);
  check('top gap opens the fork menu', (await b.ev(`document.querySelector('.node-menu')?.innerText ?? ''`)).includes('new fork here'));
  await key('Escape', 27);
  await b.shot('11-end');
  check('no page errors', b.errors.length === 0, J(b.errors.slice(0, 4)));
  console.log(bad ? `FAILED: ${bad} check(s)` : 'ALL PASS');
} catch (e) { console.log('DRIVER FAILED', e.stack.split('\n').slice(0, 3).join(' | ')); await b.shot('crash').catch(() => {}); } finally { b.close(); }
