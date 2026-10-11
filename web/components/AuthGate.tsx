'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signIn, signOut, useAuth } from '@/lib/auth';
import { lastProject, projectId, rememberProject, useProjects } from '@/lib/projects';
import { Icon } from './ui';

// When the server has sign-in on, nothing renders until the person signs in with GitHub and their account
// is approved. The landing page at "/" is public. Every page except "/" and "/projects" works on one project.
export default function AuthGate({ children }: { children: ReactNode }) {
  const a = useAuth();
  const path = usePathname();
  if (path !== '/' && a.auth && a.login && !a.approved) {
    if (a.approved === null) return null;
    return (
      <div className="hv-empty">
        <div className="hv-empty__card">
          <h1>Almost in <span className="hv-wordbox hv-wordbox--xl">Hive</span></h1>
          <p>Your account (@{a.login}) is waiting for approval. This page opens the dashboard as soon as you&apos;re approved.</p>
          <button className="hv-btn hv-btn--lg" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  if (path === '/' || !a.auth || a.login) {
    return path === '/' || path === '/projects' ? <>{children}</> : <ProjectGate>{children}</ProjectGate>;
  }
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

// Renders the page once ?project= names a real project. Without one it reopens the last project this
// browser used, or sends the person to the project list.
function ProjectGate({ children }: { children: ReactNode }) {
  const { projects, error } = useProjects();
  const router = useRouter();
  const path = usePathname();
  const id = projectId();
  const ok = !!projects?.some((p) => p.id === id);

  useEffect(() => {
    if (!projects || ok) {
      if (ok) rememberProject(id);
      return;
    }
    const q = new URLSearchParams(window.location.search);
    const last = lastProject();
    if (!id && projects.some((p) => p.id === last)) {
      q.set('project', last);
      router.replace(`${path}?${q}`);
    } else {
      q.delete('project');
      router.replace(`/projects${q.size ? `?${q}` : ''}`);
    }
  }, [projects, ok, id, path, router]);

  if (error) return <div className="hv-projects__msg">{error}</div>;
  return ok ? <>{children}</> : null;
}
