# loomz-interview: the loom with a real small model in the browser

A copy of the loom (`../../loomz`, main @ 2ddc4f9 plus the uncommitted edits of 24 Nov 2026, kept in
`.fork-base-uncommitted.patch`). Live at https://mains.in.net/mindscapes/loomz-interview/. The original is never
edited from here, and its `scripts/deploy.sh` is never run from here.

What differs from the loom:
- `src/generate.ts`: the lorem ipsum shim is gone. It hands the conversation to the model as chat turns.
- `src/model/`: `worker.ts` (transformers.js in a Web Worker: load, one completion at a time, cancel),
  `client.ts` (the page's side, settings from the address), `prompt.ts` (the text the model continues),
  `ModelPill.tsx` (the state shown top right), `protocol.ts` (the messages between page and worker).
- `src/store.ts`: `startStream` passes the pieces instead of the joined text; its own save key; an empty first
  loom instead of the lorem demo; a reply not begun before a reload is dropped; `?debug` also exposes `__loom`.
- `src/Chrome.tsx`, `src/styles.css`: the pill. `vite.config.ts`: ES workers. `scripts/deploy.sh`: its own folder.

The model: `onnx-community/Qwen2.5-0.5B-Instruct`, on WebGPU (q4: 4-bit weights run with 32-bit numbers, 786 MB)
or on the CPU through WASM (q8, 512 MB, slow). Not q4f16 (483 MB, 16-bit numbers): on the first real card it met
(Megan's, 24 Nov) it answered "hello" with nonsense while the prompt was right. The weights go from Hugging Face into the visitor's
browser cache; none are on our server. The ONNX runtime comes from the jsdelivr CDN (the library's default).
The last turn is always left open, so a fork part-way through a reply is carried on from that word.

Address settings: `?model=<hf repo>&dtype=<q4|q4f16|q8|fp32>&device=<webgpu|wasm>&system=<text|none>&temp=0.7&max=320`,
`&check=<1|0>`, `&debug`.

The check: after the default model loads it is asked "What is the capital of France?" (greedy, 16 tokens). No
"Paris" in the answer and the pill turns to "model reads wrong · <device> <dtype>"; its tooltip shows the answer,
and a click reloads with the next safer setting (off 16-bit numbers, then off the card). Other models get the check
only with `&check=1`. `&debug` prints every prompt (text and token ids) in the browser console and exposes the
store as `__loom`.

A reply that fails before its first word (the model did not load) is taken back, so the next thing typed stays
the user's own message; left empty, the loom would take it as the model's words.

Checks: `node scripts/check-prompt.mjs` (the prompt against the real tokenizer; tokenizer files only). The page was
driven in headless Chrome with `?model=hf-internal-testing/tiny-random-LlamaForCausalLM&dtype=fp32` (random
weights, 8 MB) on WASM and on a software WebGPU adapter. The real model was not run on mains (no GPU, no weights).
`scripts/browser-checks/` (headless Chrome over CDP, no packages): `t1.mjs` replays a chat with the real tokenizer
in the built page with weight files blocked and saves the prompts; `megan-24nov-prompts.json` is that for her
24 Nov chat (equal to the official Qwen template; `<|im_start|>` 151644 and `<|im_end|>` 151645 as single ids);
`t2.mjs` one fork then three messages on the random model; `t3.mjs` the failed-load case; `live.mjs` the live page.

## Typing and forking in the chat (24 Nov, Megan's list; differs from the original loom)
- No role tags. One bubble = everything one voice says before the other speaks. Text sent in the voice that spoke
  last joins that message (a newline between), in the store (`sendMessage`), on the page (`useConversation`) and
  in the prompt (`turnsOf`): one voice never has two turns in a row. A message with no words is not drawn and not
  sent (old saves had empty "open slots").
- Forking is at GAPS (before the first bubble, between two bubbles, after the last: `Gap` in `Sidebar.tsx`, a thin
  line in the chat's colour on hover) and at any WORD (back on 24 Nov, late: Megan wanted both). Click: "view
  forks here", "new fork here" (generate 1 / generate 3 / write the next message), open in new tab / window. At a
  gap, generate writes in the voice of the message that would come next; at the top gap it is another take on the
  first message. At a word inside a message the assistant writes from there (it carries its own message on, or
  answers hers cut there); at a message's first word it is another take on that message (`forkAtPoint`).
- The three dots right of the box (`ChatMenu`, prefs in `src/chat/prefs.ts`, kept in localStorage): auto-prompt
  on/off (default on) and "your messages show up as the" user / assistant / alternate. The + menu is gone.
- Auto-prompt off: a robot button (`RobotButton`) after the last word of the last bubble (carry that message on)
  and one in the empty row on the other side (start the other voice's message); both sides in an empty chat. The
  row is always there, so nothing jumps; a button shows only while the mouse is over its half of the chat.
  The model can write as the user, and can speak first.
- While a reply is written the send button is a stop button (`stopGenerating`): the words so far stay; a reply
  with no word yet is removed. Typing waits; everything else works meanwhile. A second request anywhere queues
  (one at a time in the worker) and its bubble says "waiting for its turn…" (`streamOrder`). A fork above a
  message being written moves the stream with the message (`splitNode` re-keys it).
- The worker lets one message in before every token (`breathe` in `model/worker.ts`). Without it, on WASM, a stop
  was heard only after the last token: the page dropped the words but the next request sat behind the old one.
- The fork row under the last message (`.fork-tree`) is `flex: none`: it scrolls sideways, so in the chat's flex
  column it was squashed to its scrollbar as soon as the chat was longer than its window (the original loom has
  the same fault). The ⋮ menu is moved right when a narrow chat (240 px) would push its left side off the window.
  Check: `scripts/browser-checks/words.mjs` (fork row, ⋮ button and menu at 240 px, forks at words).
- Look (24 Nov, late): icon buttons are fully round (send, ⋮, robot: a 30 px pill, its speech mark drawn as thin
  as the robot's lines); things with text have the menus' 4 px corners (the model label top right, a gap's count).
  The robot buttons' sides are 70 / 30: the voice that spoke last has the wide side. A tab is never wider than
  136 px, also when the tabs are stacked (the stack tab sits right beside it). The line under the tab row is the
  window's own colour from edge to edge (`.col-head::after`), over the other tabs' grey sides, under the current tab.
- Checks: `scripts/browser-checks/ui.mjs` (all of the above by mouse and keys on the random model; needs the
  mouse flag in the file, headless Chrome says it has no mouse), `scripts/check-prompt.mjs` (the new turn shapes
  against the real Qwen tokenizer).

## Fork marks in the chat (24 Nov, differs from the original loom)
The original marks one fork in up to three places (the cut message's end tag, the next message's start tag and its
first word). Here `src/chat/forkMarks.ts` decides: every other branch at a fork point is marked once, where this
path stops being the same as it. In the middle of a bubble: on that word. At a bubble's first word, or a bubble
against no bubble: on the gap above. Nothing drawn after the point: the chat's last gap. A node's own later text
counts as a branch when the path leaves through a child. Counts are OTHER branches (the one being read is not
counted). The end gap is not lit when the same branches are drawn as the row under the last message. Checks:
`marks.mjs` (11 hand-made trees, then random trees built with the loom's own fork action: the mark must sit where
two readings first differ, and every lit spot is opened and must list as many branches as it counts; 100 trees,
1,260 spots, all right) and `flow.mjs` (her steps by clicks on the random model: one fork, one mark, one branch
listed).
