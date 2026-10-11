// The only contract between web/ and server/. Frozen after setup: change only if both people agree.

export type SectionType = 'nav' | 'hero' | 'features' | 'cta' | 'footer';

export interface Section {           // ydoc.getMap('sections'), written by humans + Design agent
  id: string; type: SectionType; order: number;
  headline: string; subtext: string; ctaText: string;
  items: string[];                   // feature cards, nav links
  bg: string; fg: string; ctaBg: string; ctaFg: string;   // hex colors
  animation: 'none' | 'gradient' | 'fade';
  requirement: string;               // what the section must do, in words
  lastWhy?: string;                  // reason typed with the last requirement change
}

export interface CodeUnit {          // ydoc.getMap('code'), written by the server
  html: string;                      // Tailwind HTML snippet, no <script>
  builtFromVersion: number;          // section version it was generated from
  status: 'generating' | 'ready' | 'stale' | 'error';
}

export interface Task {              // ydoc.getMap('tasks'), written by the server
  id: string; agent: 'design' | 'engineering';
  sectionId: string; instruction: string;
  status: 'running' | 'stale' | 'restarting' | 'done' | 'failed';
  startedAtVersion: number; restarts: number; note: string; requestedBy: string;
}

export interface Conflict {          // ydoc.getMap('conflicts'), written by the server
  id: string; sectionId: string;
  reason: string;                    // 'CTA contrast 1.4:1 < 3:1' or 'both changed headline'
  optionA: Partial<Section>; optionB: Partial<Section>; merged?: Partial<Section>;
  mergedPasses: boolean;
  status: 'open' | 'auto-resolved' | 'resolved';
  resolution?: string; rule?: string;
}

export interface Decision {          // ydoc.getArray('decisions'), appended by the server
  id: string; at: string;
  kind: 'requirement-change' | 'agent-change' | 'conflict' | 'publish';
  sectionId?: string; who: string;
  summary: string;                   // 'Hero: animated gradient -> static image'
  why?: string;                      // the human's one-line reason
  details?: Record<string, unknown>; // before/after values, check results
}

// Y.Doc layout
export const DOC_NAME = 'hive';
export const MAPS = {
  sections: 'sections',
  code: 'code',
  tasks: 'tasks',
  conflicts: 'conflicts',
} as const;
export const DECISIONS = 'decisions';

export const SERVER_PORT = 4000;
export const WEB_PORT = 5173;
