'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// "/" has no page of its own: send people to the overview, keeping ?name=.
export default function Root() {
  const router = useRouter();
  useEffect(() => { router.replace(`/overview${window.location.search}`); }, [router]);
  return null;
}
