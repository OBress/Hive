'use client';

import type { Section } from '@hive/shared/types';
import { MAPS } from '@hive/shared/types';
import { useStatus, useUserName, useYMap } from '@/lib/hive';

// Placeholder shell: proves the Y.Doc syncs. Replace with App layout (editor | canvas + preview | panels).
export default function Home() {
  const name = useUserName();
  const status = useStatus();
  const sections = Object.values(useYMap<Section>(MAPS.sections)).sort((a, b) => a.order - b.order);

  return (
    <main style={{ padding: 24 }}>
      <h1>Hive</h1>
      <p>You are <b>{name}</b> · server: <b>{status}</b></p>
      <ol>
        {sections.map((s) => (
          <li key={s.id}>{s.type}: {s.headline}</li>
        ))}
      </ol>
    </main>
  );
}
