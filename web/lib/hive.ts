'use client';

import { useEffect, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { accessToken, initAuth, loadConfig, serverUrl, useAuth } from './auth';
import { projectId } from './projects';

// One provider per browser tab, on the current project's doc (?project=). The server host follows the page host so a LAN IP works too.
let provider: HocuspocusProvider | null = null;

export function getProvider(): HocuspocusProvider {
  if (!provider) {
    provider = new HocuspocusProvider({
      url: serverUrl().replace(/^http/, 'ws'),
      name: projectId(),
      // The doc epoch this page loaded with, plus the Supabase access token when sign-in is on.
      token: async () => {
        const { epoch } = await loadConfig();
        await initAuth();
        return JSON.stringify({ epoch, access: accessToken() });
      },
      // The server was reset since this page loaded: reload instead of merging an old doc into the new one.
      onAuthenticationFailed: ({ reason }) => { if (reason === 'stale-epoch') window.location.reload(); },
    });
  }
  return provider;
}

export const apiUrl = (path: string) => `${serverUrl()}${path}`;

// The GitHub login when sign-in is on; otherwise ?name= from the URL.
export function useUserName(): string {
  const [name, setName] = useState('Guest');
  const auth = useAuth();
  useEffect(() => {
    setName(new URLSearchParams(window.location.search).get('name') ?? 'Guest');
  }, []);
  return auth.auth ? auth.login ?? 'Guest' : name;
}

// Re-render whenever a top-level Y.Map changes; returns its current plain-object snapshot.
export function useYMap<T>(key: string): Record<string, T> {
  const [value, setValue] = useState<Record<string, T>>({});
  useEffect(() => {
    const map = getProvider().document.getMap<T>(key);
    const update = () => setValue(map.toJSON() as Record<string, T>);
    update();
    map.observeDeep(update);
    return () => map.unobserveDeep(update);
  }, [key]);
  return value;
}

// ---- presence (Hocuspocus awareness) ---------------------------------------

export interface Peer { clientId: number; name: string; openTaskId?: string }

// Everyone else connected to the doc, one entry per name (several tabs collapse into one).
export function usePeers(): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    const aw = getProvider().awareness;
    if (!aw) return;
    const update = () => {
      const byName = new Map<string, Peer>();
      aw.getStates().forEach((st, clientId) => {
        const u = st.user as { name?: string; openTaskId?: string } | undefined;
        if (clientId === aw.clientID || !u?.name || u.name === 'Guest') return;
        byName.set(u.name, { clientId, name: u.name, openTaskId: u.openTaskId });
      });
      setPeers([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };
    update();
    aw.on('change', update);
    return () => aw.off('change', update);
  }, []);
  return peers;
}

// Tell others who this tab is and which task it has open.
export function useAnnounce(name: string, openTaskId?: string | null) {
  useEffect(() => {
    getProvider().setAwarenessField('user', { name, openTaskId: openTaskId ?? undefined });
  }, [name, openTaskId]);
}

export function useStatus(): string {
  const [status, setStatus] = useState('connecting');
  useEffect(() => {
    const p = getProvider();
    setStatus(p.configuration.websocketProvider.status);   // already connected when switching pages
    const onStatus = ({ status }: { status: string }) => setStatus(status);
    p.on('status', onStatus);
    return () => { p.off('status', onStatus); };
  }, []);
  return status;
}
