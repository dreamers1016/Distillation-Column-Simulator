// Click-vs-drag picking: a pointer press/release moving under 5 px raycasts the scene
// and reports the nearest ancestor's `userData.part` (a PartRef). Points are ignored.
import { Object3D, PerspectiveCamera, Raycaster, Vector2 } from 'three';
import type { PartRef } from '../app/state';

/** A press/release pair moving less than this many CSS px counts as a click, not a drag. */
export const CLICK_MAX_MOVE_PX = 5;

export function isClick(down: readonly [number, number], up: readonly [number, number]): boolean {
  return Math.hypot(up[0] - down[0], up[1] - down[1]) < CLICK_MAX_MOVE_PX;
}

/** Nearest `userData.part` at or above `object`, or null. */
export function resolvePart(object: Object3D | null): PartRef | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.userData.part) return o.userData.part as PartRef;
  }
  return null;
}

function visibleInTree(o: Object3D): boolean {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

export class Picker {
  private roots: Object3D[] = [];
  private readonly handlers = new Set<(ref: PartRef) => void>();
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  /** The primary pointer's press: its id and where it went down. */
  private downAt: { id: number; at: [number, number] } | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointercancel', this.onCancel);
  }

  /** Objects (recursively) that can be picked. */
  setRoots(roots: Object3D[]): void {
    this.roots = roots;
  }

  onPick(fn: (ref: PartRef) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onDown);
    this.dom.removeEventListener('pointerup', this.onUp);
    this.dom.removeEventListener('pointercancel', this.onCancel);
    this.downAt = null;
    this.handlers.clear();
    this.roots = [];
  }

  /**
   * Only the primary pointer (first finger / mouse / pen) with the main button picks. A second
   * finger landing turns the gesture into a pinch or two-finger pan: it is ignored here and
   * the first press no longer counts as a click either.
   */
  private readonly onDown = (e: PointerEvent) => {
    if (e.isPrimary === false) {
      this.downAt = null;
      return;
    }
    this.downAt = e.button === 0 ? { id: e.pointerId, at: [e.clientX, e.clientY] } : null;
  };

  /** The browser took the pointer (scroll, gesture, lost capture): no click. */
  private readonly onCancel = (e: PointerEvent) => {
    if (this.downAt && this.downAt.id === e.pointerId) this.downAt = null;
  };

  private readonly onUp = (e: PointerEvent) => {
    const down = this.downAt;
    if (!down || down.id !== e.pointerId) return; // another pointer's release
    this.downAt = null;
    if (!isClick(down.at, [e.clientX, e.clientY]) || this.roots.length === 0) return;
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray
      .intersectObjects(this.roots, true)
      .find((h) => !(h.object as { isPoints?: boolean }).isPoints && visibleInTree(h.object));
    const part = hit ? resolvePart(hit.object) : null;
    if (part) this.handlers.forEach((fn) => fn(part));
  };
}
