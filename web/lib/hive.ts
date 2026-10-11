'use client';

import { useEffect, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { DOC_NAME, SERVER_PORT } from '@hive/shared/types';

// One provider per browser tab. The server host follows the page host so a LAN IP works too.
let provider: HocuspocusProvider | null = null;

export function getProvider(): HocuspocusProvider {
  if (!provider) {
    provider = new HocuspocusProvider({
      url: `ws://${window.location.hostname}:${SERVER_PORT}`,
      name: DOC_NAME,
    });
  }
  return provider;
}

export const apiUrl = (path: string) => `http://${window.location.hostname}:${SERVER_PORT}${path}`;

export function useUserName(): string {
  const [name, setName] = useState('Guest');
  useEffect(() => {
    setName(new URLSearchParams(window.location.search).get('name') ?? 'Guest');
  }, []);
  return name;
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

export function useStatus(): string {
  const [status, setStatus] = useState('connecting');
  useEffect(() => {
    const p = getProvider();
    const onStatus = ({ status }: { status: string }) => setStatus(status);
    p.on('status', onStatus);
    return () => { p.off('status', onStatus); };
  }, []);
  return status;
}
