'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { signIn, useAuth } from '@/lib/auth';
import { Icon } from './ui';

// When the server has sign-in on, nothing renders until the person signs in with GitHub.
// The landing page at "/" is public.
export default function AuthGate({ children }: { children: ReactNode }) {
  const a = useAuth();
  const path = usePathname();
  if (path === '/' || !a.auth || a.login) return <>{children}</>;
  return (
    <div className="hv-empty">
      <div className="hv-empty__card">
        <h1>Sign in to <span className="hv-wordbox hv-wordbox--xl">Hive</span></h1>
        <p>Your GitHub account is your name here: steps, chat and commits use it, and Approve pushes as you.</p>
        <button className="hv-btn hv-btn--hot hv-btn--lg" onClick={signIn}>Sign in with GitHub <Icon name="arrow" /></button>
      </div>
    </div>
  );
}
