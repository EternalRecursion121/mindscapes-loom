import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { colorOf, countHiddenChildren, useLoom, useUi, type Message } from '../store';
import { useNodeGestures } from './gestures';
import robotLines from '../assets/robot-lines.png';
import robotFill from '../assets/robot-fill.png';

/** color: thread colour if the node is on an open chat's path; selected: colour of the chat currently on this node */
export type LoomData = { color?: number; selected?: number };
export type LoomFlowNode = Node<LoomData, 'loom'>;
export type RootFlowNode = Node<LoomData, 'root'>;

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);

/** First few words of the node's first message and last few of its last one. */
function preview(messages: Message[], n = 7) {
  if (!messages.length) return null;
  const first = messages[0];
  const last = messages[messages.length - 1];
  const all = words(messages.map((m) => m.text).join(' '));
  if (all.length <= n * 2) return { head: all.join(' '), headRole: first.role, tail: '', tailRole: last.role };
  const lw = words(last.text);
  const tail = (lw.length ? lw : all).slice(-(n - 2)).join(' ');
  return { head: all.slice(0, n).join(' '), headRole: first.role, tail, tailRole: last.role };
}

function HiddenBadge({ id }: { id: string }) {
  const hidden = useLoom((s) => countHiddenChildren(s.nodes, s.children, id));
  if (!hidden) return null;
  return <span className="lnode-hidden">+{hidden} hidden</span>;
}

export const LoomNodeView = memo(function LoomNodeView({ id, data }: NodeProps<LoomFlowNode>) {
  const node = useLoom((s) => s.nodes[id]);
  const picked = useUi((s) => s.selection.includes(id));
  const linked = useUi((s) => s.linkHover === id);
  const g = useNodeGestures(id);
  if (!node) return null;
  const c = colorOf(data.color);
  const p = preview(node.messages);
  const generating = node.messages.some((m) => m.generating);
  const count = node.messages.length;
  const style = {
    '--c': c.core,
    '--f': c.fringe,
    '--sel': data.selected === undefined ? undefined : colorOf(data.selected).core,
    '--sel-dark': data.selected === undefined ? undefined : colorOf(data.selected).dark,
  } as CSSProperties;
  return (
    <div
      className="lnode nopan nodrag"
      data-threaded={data.color !== undefined || undefined}
      data-selected={data.selected !== undefined || undefined}
      data-picked={picked || undefined}
      data-linked={linked || undefined}
      data-generating={generating || undefined}
      style={style}
      {...g}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="lnode-meta">
        {count === 0 ? '' : count === 1 ? '1 msg' : `${count} msgs`}
      </span>
      {p ? (
        <>
          <p className={`lnode-head ${p.headRole}`}>
            {p.head || (generating ? <em className="lnode-empty">weaving…</em> : '')}
            {p.tail ? '…' : ''}
          </p>
          {p.tail && <p className={`lnode-tail ${p.tailRole}`}>… {p.tail}</p>}
        </>
      ) : (
        <p className="lnode-head">
          <em className="lnode-empty">empty</em>
        </p>
      )}
      <HiddenBadge id={id} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

export const RootNodeView = memo(function RootNodeView({ id }: NodeProps<RootFlowNode>) {
  const g = useNodeGestures(id);
  return (
    <div className="root-node nopan nodrag" {...g}>
      <Robot />
      <HiddenBadge id={id} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

/**
 * The loom's robot, from the hand drawing: two alpha masks cut from it (the ink lines and the
 * inside of the head), so CSS can colour each one.
 */
export function Robot() {
  return (
    <div className="robot" role="img" aria-label="the model">
      <span className="robot-fill" style={{ maskImage: `url(${robotFill})`, WebkitMaskImage: `url(${robotFill})` }} />
      <span className="robot-lines" style={{ maskImage: `url(${robotLines})`, WebkitMaskImage: `url(${robotLines})` }} />
    </div>
  );
}
