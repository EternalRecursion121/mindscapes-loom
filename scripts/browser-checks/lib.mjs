// Headless Chrome over CDP for the built loom (no deps: node 22's fetch and WebSocket).
// Every target (page and workers) is held at start until weight files are blocked, when asked.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function open(url, outDir, { port = 19333, flags = [], block = [] } = {}) {
  mkdirSync(outDir, { recursive: true });
  const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`,
    `--user-data-dir=${outDir}/profile`, '--window-size=1400,900', '--no-first-run', ...flags, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const waiting = new Map();
  const errors = [], requests = [], failed = [], sizes = [], id2url = new Map();
  const cdp = (method, params = {}, sessionId) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    const p = m.params;
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(p.type)) errors.push(p.type + ' ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (m.method === 'Target.attachedToTarget') {
      const s = p.sessionId;
      (async () => {
        await cdp('Network.enable', {}, s);
        if (block.length) await cdp('Network.setBlockedURLs', { urls: block }, s);
        await cdp('Runtime.runIfWaitingForDebugger', {}, s);
      })();
      return;
    }
    if (m.method === 'Network.requestWillBeSent') { id2url.set(p.requestId, p.request.url); if (p.request.url.startsWith('http')) requests.push(p.request.url); }
    if (m.method === 'Network.loadingFailed') failed.push((p.blockedReason ?? p.errorText) + ' ' + (id2url.get(p.requestId) ?? '?'));
    if (m.method === 'Network.loadingFinished' && p.encodedDataLength > 2e5) sizes.push((p.encodedDataLength / 1e6).toFixed(1) + ' MB ' + (id2url.get(p.requestId) ?? '?').split('/').slice(2).join('/').slice(0, 90));
  };
  const ev = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result.result.value;
  };
  for (const d of ['Runtime', 'Page', 'Network']) await cdp(d + '.enable');
  if (block.length) await cdp('Network.setBlockedURLs', { urls: block });
  await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  // keep what the page logs under ?debug: the prompt text and its token ids
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__prompts = []; { const o = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[loom] prompt')) __prompts.push({ text: a[0].slice(a[0].indexOf('\\n') + 1), ids: Array.from(a[1] ?? []) }); o(...a); }; }` });
  await cdp('Page.navigate', { url });
  await sleep(2500);
  const pill = () => ev(`document.querySelector('.model-pill')?.innerText ?? '(no pill)'`);
  const busy = () => ev(`Object.values(__loom.getState().nodes).some((n) => n.messages.some((m) => m.generating))`);
  const seen = [];
  const settle = async (max = 180) => {
    const t0 = Date.now();
    for (;;) {
      const p = await pill();
      if (seen[seen.length - 1] !== p) seen.push(p);
      if (!(await busy())) return ((Date.now() - t0) / 1000).toFixed(1) + 's';
      if (Date.now() - t0 > max * 1000) return 'TIMED OUT';
      await sleep(150);
    }
  };
  const say = async (text) => {
    await ev(`document.querySelector('textarea[aria-label="Message this thread"]').focus()`);
    await cdp('Input.insertText', { text });
    for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(300);
    return settle();
  };
  const shot = async (name) => writeFileSync(`${outDir}/${name}.png`, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  const close = () => { try { ws.close(); } catch { /* closing anyway */ } chrome.kill('SIGTERM'); };
  return { cdp, ev, say, settle, shot, pill, busy, seen, errors, requests, failed, sizes, close };
}
