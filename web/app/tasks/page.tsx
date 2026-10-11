'use client';

import { useCallback, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useUserName } from '@/lib/hive';
import { focusTask } from '@/lib/mock';
import Chat from '@/components/Chat';
import ConflictCards from '@/components/ConflictCard';
import Graph from '@/components/Graph';
import { EmptyState, Legend, Toast } from '@/components/StageExtras';
import TaskPanel from '@/components/TaskPanel';
import ShipBar from '@/components/ShipBar';
import TaskToolbar from '@/components/TaskToolbar';
import TopBar from '@/components/TopBar';

// Tasks page: graph | task panel (overlay) | chat
export default function TasksPage() {
  const me = useUserName();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(true);
  const close = useCallback(() => setSelected(null), []);
  const focus = useCallback((id: string) => { setSelected(id); focusTask(id); }, []);

  return (
    <ReactFlowProvider>
      <div className="hv-app">
        <TopBar me={me} openTaskId={selected}><ShipBar me={me} /></TopBar>
        <main className="hv-main">
          <section className="hv-stage">
            <Graph me={me} selected={selected} onSelect={setSelected} query={query} showDone={showDone} />
            <TaskToolbar query={query} setQuery={setQuery} showDone={showDone} setShowDone={setShowDone} onFocusTask={focus} />
            <EmptyState me={me} />
            <ConflictCards me={me} onFocusTask={focus} />
            <Legend />
            {selected && <TaskPanel id={selected} me={me} onClose={close} />}
            <Toast />
          </section>
          <Chat me={me} onFocusTask={focus} onSearch={setQuery} />
        </main>
      </div>
    </ReactFlowProvider>
  );
}
