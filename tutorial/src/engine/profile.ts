// Tray profile helpers shared by the Advanced solver (trayProfile) and the Simple-mode flow
// colouring (src/scene/flow.ts), so both use the identical tray <-> stage mapping.
//
// Mapping (spec 5.2/5.4). The last McCabe-Thiele stage N is the partial reboiler: its liquid IS
// the bottoms product, x = xB, and no tray sits in it. The A = actualTrays real trays therefore
// map onto the theoretical trays, stages 1...N-1, end to end:
//   s(k) = A > 1 ? 1 + (k - 1)(N - 2)/(A - 1) : 1
// so tray 1 is stage 1, tray A is stage N-1, and at E_o = 1 (A = N - 1) tray k IS stage k, the
// same numbering balance.ts uses for the feed tray (ceil(feedStage/E_o)) and the tray count.
// (The earlier midpoint convention s = 1 + (k - 0.5)(N - 1)/A sat half a stage low: at E_o = 1
// tray 1 read 67.5 °C against stage 1 at 66.5 °C, and the default feed tray 6 read 84.1 °C
// against the feed stage at 79.0 °C.)
//
// The stepped x_N is only a partial step and usually overshoots below xB (methanol-water
// default: 0.0100 against xB = 0.05). Stage N's node is therefore replaced by the reboiler state
// (x = xB, y = y*(xB), T = Tbub(xB)); stages 1...N-1 are unchanged and the `stages` array in
// Results stays exactly as stepped (the McCabe-Thiele chart draws the last step past xB on
// purpose). With s <= N - 1 the reboiler node is only reached by clamped, out-of-range tray
// numbers; it stays as the safe end node, so nothing can ever read the overshoot.

/** One interpolation node: liquid x, vapour y and bubble T (null in Simple mode, which has none). */
export interface ProfileNode {
  x: number;
  y: number;
  T_C: number | null;
}

/** Stages 1...N-1 as stepped, then the reboiler state (x = xB, y = y*(xB), T = Tbub(xB)) as stage N. */
export function profileNodes<S extends ProfileNode>(stages: readonly S[], reboiler: ProfileNode): ProfileNode[] {
  if (stages.length < 2) return stages.map((s) => ({ x: s.x, y: s.y, T_C: s.T_C }));
  const nodes: ProfileNode[] = stages.slice(0, -1).map((s) => ({ x: s.x, y: s.y, T_C: s.T_C }));
  nodes.push({ x: reboiler.x, y: reboiler.y, T_C: reboiler.T_C });
  return nodes;
}

/**
 * State on actual tray k (1 = top): linear interpolation in stage index at
 * s = 1 + (k - 1)(N - 2)/(actualTrays - 1) (s = 1 for a single tray), which spreads the trays
 * over stages 1...N-1. T_C is null when either bracketing node has none.
 */
export function interpolateTray(nodes: readonly ProfileNode[], k: number, actualTrays: number): ProfileNode {
  const N = nodes.length;
  if (N < 2) return { x: nodes[0]?.x ?? 0, y: nodes[0]?.y ?? 0, T_C: nodes[0]?.T_C ?? null };
  const trays = Math.max(1, Math.round(actualTrays));
  const s = trays > 1 ? 1 + ((k - 1) * (N - 2)) / (trays - 1) : 1;
  const j = Math.min(Math.max(Math.floor(s), 1), N - 1); // lower stage, 1-based
  const t = Math.min(Math.max(s - j, 0), 1);
  const a = nodes[j - 1];
  const b = nodes[j];
  const lerp = (u: number, v: number): number => u + t * (v - u);
  return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), T_C: a.T_C === null || b.T_C === null ? null : lerp(a.T_C, b.T_C) };
}
