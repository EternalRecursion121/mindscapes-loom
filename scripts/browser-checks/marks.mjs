// The fork marks in the chat (no model needed: trees are put straight into the store).
// Rule under test: every other branch at a fork point is marked once, where this path stops being the same as it:
// on the word, when that is in the middle of a bubble; on the gap above the bubble, when it is the bubble's first
// word (or a bubble against no bubble). Every lit spot must list as many branches as its count says. Part 1: hand-made trees with the marks written out. Part 2: random trees built with the loom's own fork
// action, checked against the pages themselves: show this branch, show the other one, find where the two first differ.
// node marks.mjs <page url with ?debug> <out dir> [port] [random trees, default 60]
import { open, sleep } from './lib.mjs';
const [url, outDir, port = '19333', trees = '60'] = process.argv.slice(2);
const b = await open(url, outDir, { port: Number(port), block: ['*huggingface.co*', '*.onnx*'] });
const inPage = () => {
  // a word is named by its text, a gap by the word above it
  const name = (e, prev) => (e.classList.contains('tok') ? 'w:' + e.textContent : e.dataset.top ? 'top' : 'gap:' + (prev?.textContent ?? ''));
  const T = (window.T = {
    wait: () => new Promise((r) => setTimeout(r, 40)),
    go(head) {
      const s = __loom.getState();
      __loom.setState({ tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, headId: head } : t)) });
    },
    // tree: { id: { p: parent id or 'root', at: [msg, offset] or null, m: [[role, text], ...] } }
    load(tree, head) {
      const s = __loom.getState();
      const nodes = { [s.rootId]: s.nodes[s.rootId] }, children = { [s.rootId]: [] };
      let y = 0;
      for (const [id, n] of Object.entries(tree)) {
        const parentId = n.p === 'root' ? s.rootId : n.p;
        const messages = n.m.map(([role, text, generating]) => (generating ? { role, text, generating } : { role, text }));
        nodes[id] = { id, parentId, forkAt: n.at ? { msg: n.at[0], offset: n.at[1] } : null, messages, x: 0, y: (y += 220), hidden: false };
        (children[parentId] ??= []).push(id);
        children[id] ??= [];
      }
      __loom.setState({ nodes, children, structure: s.structure + 1 });
      T.go(head ?? s.rootId);
    },
    els: () => {
      let prev = null;
      return [...document.querySelectorAll('.msgs .gap, .msgs .tok')].map((e) => {
        const k = name(e, prev);
        if (e.classList.contains('tok')) prev = e;
        return { e, k };
      });
    },
    // b: branches counted at the spot. q: a gap that has them and is not lit, which is right in one place only:
    // the end of the chat, where the same branches are drawn as a row under the last message
    line: () => T.els().map(({ e, k }) => { const lit = e.classList.contains('loomed'), b = Number(e.dataset.b ?? 0); return { k, b: lit || e.classList.contains('gap') ? b : 0, q: !lit && b > 0 }; }),
    quietOk: () => { const l = T.line(), row = document.querySelectorAll('.msgs .fork-tree').length; return l.every((x, i) => !x.q || (i === l.length - 1 && row === 1)); },
    marks: () => T.line().filter((x) => x.b && !x.q).map((x) => `${x.k} x${x.b}`),
    async at(head) { T.go(head); await T.wait(); return T.marks(); },
    // click a lit spot of the chat and read the list of branches it shows
    async forksAt(k) {
      const { e } = T.els().find((x) => x.k === k);
      e.click();
      await T.wait();
      const view = [...document.querySelectorAll('.node-menu button')].find((x) => x.textContent.startsWith('view forks'));
      if (view && !view.disabled) { view.click(); await T.wait(); }
      const out = view?.disabled ? 'none (greyed out)' : [...document.querySelectorAll('.node-menu .fork-pick')].map((x) => x.textContent.trim());
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await T.wait();
      return out;
    },
    // every lit spot of the chat as it is now: does its list hold as many branches as its count?
    async lists() {
      const bad = [];
      let n = 0;
      for (const x of T.line().filter((x) => x.b)) {
        n++;
        const got = await T.forksAt(x.k);
        if (!Array.isArray(got) || got.length !== x.b) bad.push(`${x.k} says ${x.b}, lists ${JSON.stringify(got)}`);
      }
      return { n, bad };
    },
    // one random tree, then every node as the head: are the marks where the pages first differ?
    async fuzz(seed) {
      let a = seed >>> 0;
      const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
      let w = 0;
      const text = () => (rnd() < 0.15 ? ' ' : '') + Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => 'w' + ++w).join(' ');
      const msgs = (n) => Array.from({ length: n }, () => ({ role: pick(['user', 'model']), text: text() }));
      const S = () => __loom.getState();
      const setMsgs = (id, messages) => __loom.setState({ nodes: { ...S().nodes, [id]: { ...S().nodes[id], messages } }, structure: S().structure + 1 });
      T.load({ n0: { p: 'root', at: null, m: msgs(2 + Math.floor(rnd() * 3)).map((m) => [m.role, m.text]) } }, 'n0');
      const ops = 3 + Math.floor(rnd() * 5);
      for (let i = 0; i < ops; i++) {
        const full = Object.values(S().nodes).filter((n) => !n.isRoot && n.messages.length);
        const n = pick(full);
        const msg = Math.floor(rnd() * n.messages.length);
        const t = n.messages[msg].text;
        const offs = [...t.matchAll(/\S+/g)].map((x) => x.index);
        // a fork needs a word to click: a message that is only a space has none
        if (rnd() < 0.7) {
          // mostly at a gap, as the chat forks now (after a message, or before a node's first one); sometimes
          // inside a message, as old saved looms and the canvas can
          const r = rnd();
          // (not at a message's first word after a leading space: that leaves a message of one space behind,
          // a bubble with no word in it, which nothing in the chat can make any more)
          const inside = offs.slice(1);
          const offset = r < 0.55 || !inside.length ? t.length : r < 0.7 ? 0 : pick(inside);
          S().forkAtPoint(S().activeTabId, n.id, msg, offset, 'write');
          const made = S().tabs.find((x) => x.id === S().activeTabId).headId;
          if (rnd() < 0.8) setMsgs(made, msgs(1 + Math.floor(rnd() * 3)));
        } else setMsgs(n.id, [...n.messages, ...msgs(1 + Math.floor(rnd() * 2))]);
      }
      const { nodes, children, rootId } = S();
      const lines = {};
      const bad = [];
      let spots = 0;
      for (const id of Object.keys(nodes)) {
        T.go(id);
        await T.wait();
        lines[id] = T.line();
        if (!T.quietOk()) bad.push({ head: id, quiet: 'a gap with branches is not lit, away from the end row' });
        const l = await T.lists();
        spots += l.n;
        if (l.bad.length) bad.push({ head: id, lists: l.bad });
      }
      let pairs = 0;
      for (const h of Object.keys(nodes)) {
        const path = [];
        for (let x = nodes[h]; x; x = nodes[x.parentId]) path.unshift(x);
        const V = lines[h];
        const want = V.map(() => 0);
        for (let i = 0; i < path.length; i++) {
          const P = path[i], next = path[i + 1], cut = next?.forkAt;
          const others = (children[P.id] ?? []).filter((c) => {
            const f = nodes[c].forkAt;
            return c !== next?.id && (!next || !cut || !f || f.msg < cut.msg || (f.msg === cut.msg && f.offset <= cut.offset));
          });
          if (next && cut && P.messages[cut.msg] && (cut.offset < P.messages[cut.msg].text.length || P.messages.length > cut.msg + 1)) others.push(P.id);
          for (const o of others) {
            pairs++;
            const O = lines[o];
            let d = 0;
            while (d < V.length && O[d]?.k === V[d].k) d++;
            // the first word of a bubble: the gap above it
            if (d < V.length && V[d].k.startsWith('w:') && d > 0 && !V[d - 1].k.startsWith('w:')) d--;
            if (d < V.length) want[d]++;
            else if (V.length && !V[V.length - 1].k.startsWith('w:')) want[V.length - 1]++;
          }
        }
        const diff = V.map((x, k) => (x.b !== want[k] ? `${x.k} has ${x.b}, expected ${want[k]}` : null)).filter(Boolean);
        if (diff.length) bad.push({ head: h, diff, line: V.map((x) => x.k).join(' ') });
      }
      return { seed, nodes: Object.keys(nodes).length - 1, pairs, spots, bad, tree: bad.length ? Object.values(nodes).filter((n) => !n.isRoot).map((n) => [n.id, n.parentId, n.forkAt && [n.forkAt.msg, n.forkAt.offset], n.messages.map((m) => m.role[0] + ':' + m.text)]) : undefined };
    },
  });
};
const U = 'user', M = 'model';
const her = { A: { p: 'root', at: null, m: [[U, 'hello'], [M, "You're asking "]] }, B: { p: 'A', at: [1, 14], m: [[M, 'the question of what it means to ask.']] } };
const cases = [
  ['her steps: cut a reply, write a new message', { ...her, C: { p: 'A', at: [1, 14], m: [[U, 'what is the capital of france'], [M, 'Paris is the capital.']] } },
    { C: ['gap:asking x1'], B: ['w:the x1'], A: [] }],
  ['the same, before anything is typed in the new branch', { ...her, C: { p: 'A', at: [1, 14], m: [] } }, { C: ['gap:asking x1'], B: ['w:the x1'] }],
  ['two replies to one message', { A: { p: 'root', at: null, m: [[U, 'hello']] }, B: { p: 'A', at: [0, 5], m: [[M, 'Hi there friend']] }, C: { p: 'A', at: [0, 5], m: [[M, 'Good day to you']] } },
    { B: ['gap:hello x1'], C: ['gap:hello x1'], A: [] }],
  ['three replies to one message', { A: { p: 'root', at: null, m: [[U, 'hello']] }, B: { p: 'A', at: [0, 5], m: [[M, 'Hi there']] }, C: { p: 'A', at: [0, 5], m: [[M, 'Good day']] }, D: { p: 'A', at: [0, 5], m: [[M, 'Yo']] } },
    { B: ['gap:hello x2'] }],
  ['a second reply that has no word yet', { A: { p: 'root', at: null, m: [[U, 'hello']] }, B: { p: 'A', at: [0, 5], m: [[M, 'Hi there']] }, C: { p: 'A', at: [0, 5], m: [[M, '', true]] } },
    { C: ['gap:hello x1'] }],
  ['a reply carried on two ways', { A: { p: 'root', at: null, m: [[U, 'hello'], [M, 'The sky is ']] }, B: { p: 'A', at: [1, 11], m: [[M, 'blue today']] }, C: { p: 'A', at: [1, 11], m: [[M, 'falling down']] } },
    { B: ['w:blue x1'], C: ['w:falling x1'] }],
  ['your own message ended two ways', { A: { p: 'root', at: null, m: [[U, 'tell me about ']] }, B: { p: 'A', at: [0, 14], m: [[U, 'cats please'], [M, 'Cats are nice']] }, C: { p: 'A', at: [0, 14], m: [[U, 'dogs now'], [M, 'Dogs bark']] } },
    { B: ['w:cats x1'], C: ['w:dogs x1'] }],
  ['two next messages after a whole reply', { A: { p: 'root', at: null, m: [[U, 'hi'], [M, 'Hello.']] }, B: { p: 'A', at: [1, 6], m: [[U, 'one thing'], [M, 'ok']] }, C: { p: 'A', at: [1, 6], m: [[U, 'another thing'], [M, 'sure']] } },
    { B: ['gap:. x1'], C: ['gap:. x1'], A: [] }],
  ['three branches of two kinds', { A: { p: 'root', at: null, m: [[U, 'hi'], [M, 'Hello ']] }, B: { p: 'A', at: [1, 6], m: [[M, 'there friend']] }, C: { p: 'A', at: [1, 6], m: [[U, 'what now'], [M, 'x y']] }, D: { p: 'A', at: [1, 6], m: [[U, 'who now'], [M, 'z']] } },
    { C: ['gap:Hello x2'], B: ['w:there x2'], D: ['gap:Hello x2'] }],
  ['a node that went on after a branch left it', { P: { p: 'root', at: null, m: [[U, 'hi'], [M, 'Hello.'], [U, 'next question'], [M, 'answer']] }, X: { p: 'P', at: [1, 6], m: [[U, 'other question'], [M, 'reply']] }, Y: { p: 'P', at: [1, 6], m: [[M, ' And more.']] } },
    { X: ['gap:. x2'], P: ['gap:. x2'], Y: ['w:And x2'] }],
  ['two threads at the root', { T1: { p: 'root', at: null, m: [[U, 'first thread'], [M, 'a']] }, T2: { p: 'root', at: null, m: [[U, 'second thread'], [M, 'b']] } }, { T1: ['top x1'] }],
];
let fails = 0;
try {
  await b.ev(`(${inPage})()`);
  for (const [name, tree, heads] of cases) {
    await b.ev(`T.load(${JSON.stringify(tree)})`);
    for (const [head, want] of Object.entries(heads)) {
      const got = await b.ev(`T.at(${JSON.stringify(head)})`);
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fails++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} | reading ${head}: ${got.join(', ') || 'no mark'}${ok ? '' : ` | expected: ${want.join(', ') || 'no mark'}`}`);
    }
    if (name.startsWith('her steps')) {
      await b.ev(`T.at('C')`);
      await b.shot('her-steps');
      console.log('     list at the gap under "You\'re asking":', JSON.stringify(await b.ev(`T.forksAt('gap:asking')`)));
    }
    if (name.startsWith('a node that went on')) { await b.ev(`T.at('X')`); console.log('     list at the gap under "Hello.":', JSON.stringify(await b.ev(`T.forksAt('gap:.')`))); }
  }
  let pairs = 0, spots = 0, badTrees = 0;
  for (let seed = 1; seed <= Number(trees); seed++) {
    const r = await b.ev(`T.fuzz(${seed})`);
    pairs += r.pairs;
    spots += r.spots;
    if (r.bad.length) { badTrees++; if (badTrees <= 6) console.log('FAIL random tree', seed, JSON.stringify(r.bad.slice(0, 2)), JSON.stringify(r.tree)); }
  }
  fails += badTrees;
  console.log(`random trees: ${trees} built, ${pairs} (reading, other branch) pairs, ${spots} lit spots opened, trees with a wrong mark or list: ${badTrees}`);
  console.log('errors on the page:', b.errors.length ? JSON.stringify(b.errors.slice(0, 4)) : 'none');
  console.log(fails ? `FAILED: ${fails}` : 'ALL PASS');
} catch (e) { console.log('DRIVER FAILED', e.message); } finally { b.close(); }
