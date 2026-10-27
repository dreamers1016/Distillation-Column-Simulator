// Sieve trays: perforated deck (one shared ExtrudeGeometry for every tray), outlet weir,
// downcomer apron and support ring. Downcomers alternate sides: tray n has its
// downcomer on +x when n is odd and on -x when n is even. Also the liquid path the
// flow particles (Task 11) follow: distributor → across each deck → over the weir →
// down the downcomer → … → sump.
import { Color, ExtrudeGeometry, Group, Mesh, Path, Shape, Vector3 } from 'three';
import { COLUMN, SUMP_LEVEL, type BuildCtx, type ColumnLayout } from './column';
import { TAU, box, ring, shared, tag, v3 } from './helpers';

/** Deck radius (just inside the shell wall). */
export const TRAY_R = COLUMN.radius - COLUMN.wall - 0.005;
/** Distance from the axis to the downcomer chord (outlet weir line). */
export const CHORD_X = 0.62 * TRAY_R;
/** Length of the weir / downcomer chord. */
export const CHORD_LEN = 2 * Math.sqrt(TRAY_R * TRAY_R - CHORD_X * CHORD_X);
/** Middle of the downcomer gap between the apron and the shell. */
export const DOWNCOMER_X = (CHORD_X + TRAY_R) / 2;
export const DECK_T = 0.025;
export const WEIR_H = 0.07;
/** Clearance under the downcomer apron above the tray below. */
export const APRON_CLEARANCE = 0.05;
const HOLE_R = 0.034;
const HOLE_PITCH = 0.12;

/** Sign of x on which tray n's downcomer sits. */
export const downcomerSide = (n: number): 1 | -1 => (n % 2 ? 1 : -1);

/**
 * Deck in its own frame (downcomer on +x): a circle minus the downcomer chord, with
 * triangular-pitch holes over the active area. The inlet area under the downcomer of
 * the tray above (x < -0.48 R) is left blank, like a real calming zone.
 */
function deckGeometry(): ExtrudeGeometry {
  return shared('trayDeck', () => {
    const a0 = Math.acos(CHORD_X / TRAY_R);
    const s = new Shape();
    s.absarc(0, 0, TRAY_R, a0, TAU - a0, false);
    s.lineTo(CHORD_X, TRAY_R * Math.sin(a0));
    let row = 0;
    for (let x = -0.48 * TRAY_R; x < CHORD_X - 0.1; x += HOLE_PITCH, row++) {
      for (let z = -TRAY_R + (row % 2 ? HOLE_PITCH / 2 : 0); z < TRAY_R; z += HOLE_PITCH) {
        if (x * x + z * z < (TRAY_R - 0.1) ** 2) {
          const h = new Path();
          h.absarc(x, z, HOLE_R, 0, TAU, true);
          s.holes.push(h);
        }
      }
    }
    const g = new ExtrudeGeometry(s, { depth: DECK_T, bevelEnabled: false, curveSegments: 9 });
    g.rotateX(Math.PI / 2); // shape y → world z; deck top at y = 0, bottom at -DECK_T
    return g;
  });
}

const COLD = new Color('#9fb6cc');
const HOT = new Color('#d6a08c');
const STEEL = new Color('#c3c8cd');
/** Feed tray deck glows slightly so it reads as "the feed tray" at any distance. */
export const FEED_TRAY_EMISSIVE = 0x0d5e52;

export function buildTrays(ctx: BuildCtx, L: ColumnLayout): Group {
  const root = new Group();
  const n = L.displayTrays;
  const apronH = COLUMN.traySpacing - APRON_CLEARANCE;
  for (let i = 0; i < n; i++) {
    const trayNo = i + 1;
    const part = { kind: 'tray' as const, tray: trayNo };
    const ms = ctx.mats(part);
    // Tint runs from cool (top, condensing end) to warm (bottom, reboiler end).
    const tint = STEEL.clone().lerp(COLD.clone().lerp(HOT, n > 1 ? i / (n - 1) : 0), 0.45);
    const deckMat = ms.tinted('deck', tint, i === L.feedTrayIndex ? FEED_TRAY_EMISSIVE : 0);
    const g = tag(new Group(), part);
    g.position.y = L.trayY[i];

    const side = new Group();
    side.rotation.y = downcomerSide(trayNo) > 0 ? 0 : Math.PI;
    const deck = new Mesh(deckGeometry(), deckMat);
    deck.userData.sub = 'deck';
    const weir = box(0.012, WEIR_H, CHORD_LEN, ms.tinted('weir', tint));
    weir.position.set(CHORD_X - 0.006, WEIR_H / 2, 0);
    weir.userData.sub = 'weir';
    const apron = box(0.012, apronH, CHORD_LEN, ms.tinted('downcomer', tint));
    apron.position.set(CHORD_X + 0.006, -apronH / 2, 0);
    apron.userData.sub = 'downcomer';
    side.add(deck, weir, apron);

    // Support ring welded to the shell; in the cutaway only its back half is drawn.
    const supportRing = ring(TRAY_R + 0.01, 0.02, deckMat, ctx.cut);
    supportRing.position.y = -0.035;
    supportRing.userData.sub = 'deck';
    g.add(side, supportRing);
    root.add(g);
  }
  return root;
}

/**
 * Polyline the liquid follows, from the distributor drip tip into the sump. On each
 * tray it enters on the inlet side (opposite the downcomer), crosses the deck, rises
 * over the weir crest, falls in the downcomer and leaves under the apron onto the
 * inlet area of the tray below.
 */
export function liquidPath(L: ColumnLayout, dripStart: Vector3): Vector3[] {
  const pts = [dripStart.clone()];
  const onDeck = 0.04;
  const inlet = CHORD_X * 0.9;
  for (let i = 0; i < L.displayTrays; i++) {
    const d = downcomerSide(i + 1);
    const y = L.trayY[i] + onDeck;
    const yNext = i + 1 < L.displayTrays ? L.trayY[i + 1] + onDeck : L.y0 + SUMP_LEVEL - 0.05;
    pts.push(
      v3(-d * inlet, y, 0),
      v3(d * (CHORD_X - 0.03), y, 0),
      v3(d * (CHORD_X + 0.01), L.trayY[i] + WEIR_H + 0.015, 0), // over the weir crest
      v3(d * DOWNCOMER_X, y - 0.02, 0),
      v3(d * DOWNCOMER_X, yNext, 0),
    );
  }
  return pts;
}
