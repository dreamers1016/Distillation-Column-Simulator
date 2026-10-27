// @vitest-environment jsdom
// Plant layout and topology, built without a renderer (Three.js objects only).
// jsdom is needed because the pins (CSS2DObject) create <div>s.
import { describe, expect, it } from 'vitest';
import { Box3, CylinderGeometry, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { defaultInputs } from '../../src/app/state';
import type { PartRef } from '../../src/app/state';
import { solve } from '../../src/engine/solve';
import type { Results } from '../../src/engine/types';
import { buildPlant, layoutColumn, HIGHLIGHT_EMISSIVE, type PlantOptions } from '../../src/scene/plant';

const inputs = defaultInputs();
const solved = solve(inputs);
if (!solved.ok) throw new Error(`default inputs must solve: ${solved.error.message}`);
const base: Results = solved;

const withTrays = (actualTrays: number, feedTray: number): Results => ({ ...base, actualTrays, feedTray });
const opts = (o: Partial<PlantOptions> = {}): PlantOptions => ({
  cutaway: true,
  utilityColors: true,
  products: { xD: inputs.xD, xB: inputs.xB },
  ...o,
});

function partsOf(root: Object3D, kind: PartRef['kind']): Object3D[] {
  const out: Object3D[] = [];
  root.traverse((o) => {
    if ((o.userData.part as PartRef | undefined)?.kind === kind) out.push(o);
  });
  return out;
}
function labels(root: Object3D): string[] {
  const out: string[] = [];
  root.traverse((o) => {
    if (o instanceof CSS2DObject) out.push(o.element.textContent ?? '');
  });
  return out;
}
const findSub = (o: Object3D, sub: string) => {
  let hit: Object3D | undefined;
  o.traverse((c) => {
    if (!hit && c.userData.sub === sub) hit = c;
  });
  return hit;
};

describe('layoutColumn', () => {
  it('15 trays: strictly decreasing trayY at 0.62 m spacing on the pinned geometry', () => {
    const L = layoutColumn(withTrays(15, 8));
    expect(L.trays).toBe(15);
    expect(L.displayTrays).toBe(15);
    expect(L.capped).toBe(false);
    expect(L.trayY).toHaveLength(15);
    for (let i = 1; i < L.trayY.length; i++) {
      expect(L.trayY[i]).toBeLessThan(L.trayY[i - 1]);
      expect(L.trayY[i - 1] - L.trayY[i]).toBeCloseTo(0.62, 9);
    }
    expect(L.y0).toBe(2.6);
    expect(L.trayY[14]).toBeCloseTo(2.6 + 1.3, 9); // sump below the bottom tray
    expect(L.yTop).toBeCloseTo(L.trayY[0] + 0.9, 9); // top space above tray 1
  });

  it('feed tray index = feedTray - 1', () => {
    expect(layoutColumn(withTrays(15, 8)).feedTrayIndex).toBe(7);
    expect(layoutColumn(withTrays(9, 1)).feedTrayIndex).toBe(0);
  });

  it('300 actual trays are displayed as 120 (capped)', () => {
    const L = layoutColumn(withTrays(300, 150));
    expect(L.trays).toBe(300);
    expect(L.displayTrays).toBe(120);
    expect(L.capped).toBe(true);
    expect(L.trayY).toHaveLength(120);
    expect(L.feedTrayIndex).toBeGreaterThanOrEqual(0);
    expect(L.feedTrayIndex).toBeLessThan(120);
  });
});

describe('buildPlant topology', () => {
  it('contains exactly displayTrays tray groups, numbered 1..n', () => {
    for (const [n, shown] of [
      [15, 15],
      [300, 120],
    ] as const) {
      const p = buildPlant(withTrays(n, Math.ceil(n / 2)), opts());
      const trays = partsOf(p.group, 'tray');
      expect(trays).toHaveLength(shown);
      expect(new Set(trays.map((t) => (t.userData.part as PartRef).tray))).toEqual(
        new Set(Array.from({ length: shown }, (_, i) => i + 1)),
      );
      p.dispose();
    }
  });

  it('tray n has its downcomer on +x when n is odd and on -x when even; deck/weir/downcomer are tagged', () => {
    const p = buildPlant(withTrays(15, 8), opts());
    p.group.updateMatrixWorld(true);
    for (const t of partsOf(p.group, 'tray')) {
      const n = (t.userData.part as PartRef).tray as number;
      expect(findSub(t, 'deck')).toBeDefined();
      expect(findSub(t, 'weir')).toBeDefined();
      const dc = findSub(t, 'downcomer') as Object3D;
      const x = dc.getWorldPosition(new Vector3()).x;
      expect(Math.sign(x)).toBe(n % 2 ? 1 : -1);
    }
    p.dispose();
  });

  it('liquidPath starts at the reflux distributor and ends in the sump liquid', () => {
    const p = buildPlant(withTrays(15, 8), opts());
    p.group.updateMatrixWorld(true);
    const [dist] = partsOf(p.group, 'distributor');
    const [sump] = partsOf(p.group, 'sump');
    const distBox = new Box3().setFromObject(dist).expandByScalar(0.02);
    const sumpBox = new Box3().setFromObject(sump).expandByScalar(0.02);
    const first = p.liquidPath[0];
    const last = p.liquidPath[p.liquidPath.length - 1];
    expect(distBox.containsPoint(first)).toBe(true);
    expect(sumpBox.containsPoint(last)).toBe(true);
    // Monotonic descent: liquid never flows uphill (it may rise only over a weir crest, < 0.1 m).
    for (let i = 1; i < p.liquidPath.length; i++) {
      expect(p.liquidPath[i].y - p.liquidPath[i - 1].y).toBeLessThan(0.1);
    }
    p.dispose();
  });

  it('cutaway opens the shell to a half section (thetaLength π), closed is 2π', () => {
    const shellTheta = (cutaway: boolean) => {
      const p = buildPlant(withTrays(15, 8), opts({ cutaway }));
      const shell = p.group.getObjectByName('shell') as Mesh;
      const theta = (shell.geometry as CylinderGeometry).parameters.thetaLength;
      p.dispose();
      return theta;
    };
    expect(shellTheta(true)).toBeCloseTo(Math.PI, 12);
    expect(shellTheta(false)).toBeCloseTo(2 * Math.PI, 12);
  });

  it('vaporBox lies inside the column between the sump and the top', () => {
    const p = buildPlant(withTrays(15, 8), opts());
    const L = layoutColumn(withTrays(15, 8));
    expect(p.vaporBox.min.y).toBeGreaterThan(L.y0);
    expect(p.vaporBox.max.y).toBeLessThanOrEqual(L.yTop);
    expect(Math.max(-p.vaporBox.min.x, p.vaporBox.max.x, -p.vaporBox.min.z, p.vaporBox.max.z)).toBeLessThan(1.0);
    p.dispose();
  });

  it('returns a camera anchor for every part kind and the overview', () => {
    const p = buildPlant(withTrays(15, 8), opts());
    const kinds: (PartRef['kind'] | 'overview')[] = [
      'overview', 'column', 'tray', 'feed', 'condenser', 'refluxDrum', 'reboiler', 'sump',
      'distributor', 'skirt', 'manway', 'platform', 'nozzle', 'cwSystem', 'steamSystem',
    ];
    for (const k of kinds) {
      expect(p.anchors[k], k).toBeDefined();
      expect(p.anchors[k].dist).toBeGreaterThan(0);
    }
    p.dispose();
  });
});

describe('labels from Results', () => {
  it('tray count, feed tray, temperatures and products name the real chemicals', () => {
    const p = buildPlant(withTrays(15, 8), opts());
    const t = labels(p.group);
    expect(t).toContain('15 sieve trays');
    expect(t).toContain('Feed → tray 8');
    expect(t.some((s) => /^Top ≈ \d/.test(s))).toBe(true); // Simple mode: estimate
    expect(t.some((s) => /^Bottom ≈ \d/.test(s))).toBe(true);
    const kgD = Math.round(base.D_kgh).toLocaleString('en-US');
    const kgB = Math.round(base.B_kgh).toLocaleString('en-US');
    expect(t).toContain(`Distillate: 95 mol% methanol · ${kgD} kg/h`);
    expect(t).toContain(`Bottoms: 95 mol% water · ${kgB} kg/h`);
    expect(t.join(' ')).not.toMatch(/blue|orange/i);
    p.dispose();
  });

  it('capped column says "120+ trays (column shortened for display)"', () => {
    const p = buildPlant(withTrays(300, 150), opts());
    expect(labels(p.group)).toContain('120+ trays (column shortened for display)');
    p.dispose();
  });

  it('Advanced temperatures have no "≈"', () => {
    const p = buildPlant({ ...withTrays(15, 8), mode: 'advanced', TtopIsEstimate: false }, opts());
    const t = labels(p.group);
    expect(t.some((s) => /^Top \d/.test(s))).toBe(true);
    expect(t.some((s) => /^Bottom \d/.test(s))).toBe(true);
    p.dispose();
  });
});

describe('utility lines follow the selected utility', () => {
  const lineColor = (p: ReturnType<typeof buildPlant>, kind: PartRef['kind']) => {
    const [g] = partsOf(p.group, kind);
    let hex = -1;
    g.traverse((o) => {
      if (hex < 0 && o.userData.utilityLine) hex = ((o as Mesh).material as MeshStandardMaterial).color.getHex();
    });
    return hex;
  };

  it('CW: green #3d8f5a, "CW 30→40 °C"; LP steam brown #8a6a2a, "LP steam 3.5 barg"', () => {
    expect(base.condenser.utility).toBe('CW');
    expect(base.reboiler.level).toBe('LP');
    const p = buildPlant(withTrays(15, 8), opts());
    expect(lineColor(p, 'cwSystem')).toBe(0x3d8f5a);
    expect(lineColor(p, 'steamSystem')).toBe(0x8a6a2a);
    const t = labels(p.group);
    expect(t).toContain('CW 30→40 °C');
    expect(t).toContain('LP steam 3.5 barg');
    p.dispose();
  });

  it('ChW: cyan #2fa8c8, "ChW 7→12 °C"; MP steam "MP steam 10 barg"', () => {
    const r: Results = {
      ...withTrays(15, 8),
      condenser: { ...base.condenser, utility: 'ChW', in_C: 7, out_C: 12 },
      reboiler: { ...base.reboiler, level: 'MP', P_barg: 10 },
    };
    const p = buildPlant(r, opts());
    expect(lineColor(p, 'cwSystem')).toBe(0x2fa8c8);
    const t = labels(p.group);
    expect(t).toContain('ChW 7→12 °C');
    expect(t).toContain('MP steam 10 barg');
    p.dispose();
  });
});

describe('highlight and ghosting', () => {
  const emissiveOf = (o: Object3D) => {
    const hexes = new Set<number>();
    o.traverse((c) => {
      const m = (c as Mesh).material as MeshStandardMaterial | undefined;
      if ((c as Mesh).isMesh && m?.emissive) hexes.add(m.emissive.getHex());
    });
    return hexes;
  };

  it('highlighting tray 3 lights only tray 3 (no shared materials leak)', () => {
    const p = buildPlant(withTrays(15, 8), opts());
    const trays = partsOf(p.group, 'tray');
    const tray = (n: number) => trays.find((t) => (t.userData.part as PartRef).tray === n) as Object3D;
    p.highlight({ kind: 'tray', tray: 3 });
    expect(emissiveOf(tray(3))).toEqual(new Set([HIGHLIGHT_EMISSIVE]));
    expect(emissiveOf(tray(4)).has(HIGHLIGHT_EMISSIVE)).toBe(false);
    expect(emissiveOf(partsOf(p.group, 'column')[0]).has(HIGHLIGHT_EMISSIVE)).toBe(false);
    p.highlight({ kind: 'condenser' });
    expect(emissiveOf(tray(3)).has(HIGHLIGHT_EMISSIVE)).toBe(false);
    expect(emissiveOf(partsOf(p.group, 'condenser')[0])).toEqual(new Set([HIGHLIGHT_EMISSIVE]));
    p.highlight(null);
    expect(emissiveOf(partsOf(p.group, 'condenser')[0]).has(HIGHLIGHT_EMISSIVE)).toBe(false);
    p.dispose();
  });

  it('setGhost(true) puts every material at <= 50 % opacity and setGhost(false) restores it', () => {
    const p = buildPlant(withTrays(15, 8), opts());
    const mats = () => {
      const out: MeshStandardMaterial[] = [];
      p.group.traverse((c) => {
        if ((c as Mesh).isMesh) out.push((c as Mesh).material as MeshStandardMaterial);
      });
      return out;
    };
    const before = mats().map((m) => [m.opacity, m.transparent] as const);
    p.setGhost(true);
    for (const [i, m] of mats().entries()) {
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBeCloseTo(before[i][0] * 0.5, 9);
    }
    p.setGhost(false);
    expect(mats().map((m) => [m.opacity, m.transparent] as const)).toEqual(before);
    p.dispose();
  });
});

describe('material pooling across rebuilds', () => {
  const firstMaterial = (p: ReturnType<typeof buildPlant>, kind: PartRef['kind']) => {
    let m: unknown;
    partsOf(p.group, kind)[0].traverse((c) => {
      if (!m && (c as Mesh).isMesh) m = (c as Mesh).material;
    });
    return m;
  };

  it('a rebuild reuses the same material objects (no shader-program churn on slider moves)', () => {
    const a = buildPlant(withTrays(15, 8), opts());
    const ma = firstMaterial(a, 'column');
    a.dispose();
    const b = buildPlant(withTrays(16, 8), opts({ cutaway: false }));
    expect(firstMaterial(b, 'column')).toBe(ma);
    b.dispose();
  });

  it('a highlight or ghosting left on the old plant does not carry into the new one', () => {
    const a = buildPlant(withTrays(15, 8), opts());
    a.highlight({ kind: 'condenser' });
    a.setGhost(true);
    a.dispose();
    const b = buildPlant(withTrays(15, 8), opts());
    const m = firstMaterial(b, 'condenser') as MeshStandardMaterial;
    expect(m.emissive.getHex()).not.toBe(HIGHLIGHT_EMISSIVE);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    b.dispose();
  });
});

describe('rebuild cost', () => {
  it('a 40-tray rebuild (geometry cache warm) is fast', () => {
    buildPlant(withTrays(40, 20), opts()).dispose(); // warm the shared-geometry cache
    const runs: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      const p = buildPlant(withTrays(40, 20), opts({ cutaway: k % 2 === 0 }));
      runs.push(performance.now() - t0);
      p.dispose();
    }
    runs.sort((a, b) => a - b);
    console.info(`40-tray buildPlant (jsdom, no renderer): median ${runs[2].toFixed(1)} ms, min ${runs[0].toFixed(1)} ms`);
    expect(runs[2]).toBeLessThan(50);
  });
});
