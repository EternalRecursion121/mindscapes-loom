import { useEffect } from 'react';
import { useIsMobile } from './useIsMobile';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { NodeMenu, NodeTooltip, Toast } from './canvas/Overlays';
import { MobileChat, Sidebar } from './chat/Sidebar';
import { useLoom } from './store';

/** ctrl/cmd + z undoes, ctrl/cmd + y or ctrl/cmd + shift + z redoes. Text fields keep their own undo. */
function useUndoKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useLoom.getState().undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useLoom.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}


export function App() {
  useUndoKeys();
  const mobile = useIsMobile();
  // on a phone the sidebar toggle swaps between the chat and the tree: only one is rendered
  const showChat = useLoom((s) => !s.sidebarFolded && s.tabs.length > 0);
  return (
    <ReactFlowProvider>
      <div className={`app${mobile ? ' mobile' : ''}`}>
        <main className="workspace">
          {mobile ? (
            showChat ? <MobileChat /> : <Canvas />
          ) : (
            <>
              <Sidebar />
              <Canvas />
            </>
          )}
        </main>
        <NodeTooltip />
        <NodeMenu />
        <Toast />
      </div>
    </ReactFlowProvider>
  );
}
