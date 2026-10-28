// @vitest-environment jsdom
// Shadow frustum fitted to the plant (Task 15 item 8): a 120-tray column still casts and
// receives shadows over its whole height, and its floor shadow is covered too.
import { describe, expect, it } from 'vitest';
import { Box3, Matrix4, Vector3 } from 'three';
import { defaultInputs } from '../../src/app/state';
import { solve } from '../../src/engine/solve';
import type { Results } from '../../src/engine/types';
import { buildPlant } from '../../src/scene/plant';
import { shadowBoundsFor, SUN_OFFSET, sunPositionFor } from '../../src/scene/scene';

const solved = solve(defaultInputs());
if (!solved.ok) throw new Error('default inputs must solve');
const base: Results = solved;
const plantBox = (actualTrays: number) => {
  const p = buildPlant({ ...base, actualTrays, feedTray: Math.ceil(actualTrays / 2) }, { cutaway: false, utilityColors: true, products: { xD: 0.95, xB: 0.05 } });
  const box = p.anchors.overview.box ?? new Box3().setFromObject(p.group);
  p.dispose();
  return box;
};

/** Point in the sun's view space (the shadow camera looks down -z from the sun at the origin). */
const toSun = (p: Vector3, sun: Vector3) => p.clone().applyMatrix4(new Matrix4().lookAt(sun, new Vector3(), new Vector3(0, 1, 0)).setPosition(sun).invert());

describe('shadowBoundsFor', () => {
  it.each([6, 40, 120])('covers every corner of a %i-tray plant and its floor shadow', (n) => {
    const box = plantBox(n);
    const sun = sunPositionFor(box);
    expect(sun.clone().normalize().distanceTo(SUN_OFFSET.clone().normalize())).toBeLessThan(1e-12); // same light direction
    const b = shadowBoundsFor(box, sun);
    const dir = SUN_OFFSET.clone().normalize();
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const corner = new Vector3(x, y, z);
          const floor = corner.clone().addScaledVector(dir, -y / dir.y); // where its shadow lands
          for (const p of [corner, floor]) {
            const v = toSun(p, sun);
            expect(v.x).toBeGreaterThanOrEqual(b.left);
            expect(v.x).toBeLessThanOrEqual(b.right);
            expect(v.y).toBeGreaterThanOrEqual(b.bottom);
            expect(v.y).toBeLessThanOrEqual(b.top);
            expect(-v.z).toBeGreaterThanOrEqual(b.near);
            expect(-v.z).toBeLessThanOrEqual(b.far);
          }
        }
  });

  it('grows with the column: the old fixed frustum (top 36) did not reach a 120-tray column', () => {
    const [tb, sb] = [plantBox(120), plantBox(6)];
    const tall = shadowBoundsFor(tb, sunPositionFor(tb));
    const short = shadowBoundsFor(sb, sunPositionFor(sb));
    expect(tall.top - tall.bottom).toBeGreaterThan(short.top - short.bottom);
    expect(tall.top - tall.bottom).toBeGreaterThan(36 + 6);
  });
});
