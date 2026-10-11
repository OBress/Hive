// Top-to-bottom layered layout for the task graph, shared by the server (when the planner changes the graph)
// and the browser (when cards overlap). Edges leave a card's bottom and enter the next card's top, so
// each task sits one row below its deepest dependency; cards in a row are ordered by where their
// dependencies sit, to keep edges from crossing.

export const NODE_W = 260;            // .hv-node width in web/app/globals.css
export const NODE_H = 130;            // a two-line title, when the real height isn't measured
const GAP_X = 60;
const GAP_Y = 80;

export function layoutGraph(
  tasks: { id: string; deps: string[] }[],
  height: (id: string) => number = () => NODE_H,
): Record<string, { x: number; y: number }> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;   // a cycle can't be saved, but never loop on one
    seen.add(id);
    const deps = (byId.get(id)?.deps ?? []).filter((d) => byId.has(d));
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depthOf(x, seen))) : 0;
    depth.set(id, d);
    return d;
  };
  const rows: string[][] = [];
  for (const t of tasks) (rows[depthOf(t.id)] ??= []).push(t.id);

  const out: Record<string, { x: number; y: number }> = {};
  let y = 0;
  for (const row of rows) {
    if (!row) continue;
    // Order by the average x of each card's dependencies (already placed), then by id for stability.
    const center = (id: string) => {
      const xs = (byId.get(id)!.deps).filter((d) => out[d]).map((d) => out[d].x);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    row.sort((a, b) => center(a) - center(b) || a.localeCompare(b));
    const width = row.length * NODE_W + (row.length - 1) * GAP_X;
    row.forEach((id, i) => { out[id] = { x: Math.round(i * (NODE_W + GAP_X) - width / 2 + NODE_W / 2), y }; });
    y += Math.max(...row.map(height)) + GAP_Y;
  }
  return out;
}

// True when any two cards (with their real heights) are closer than `margin` px.
export function overlaps(
  boxes: { x: number; y: number; h: number }[], margin = 16,
): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (Math.abs(a.x - b.x) < NODE_W + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin) return true;
    }
  }
  return false;
}
