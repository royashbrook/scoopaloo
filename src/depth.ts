import type { Point } from './engine'

// The 3/4 depth rule (#14), pure and shared: things farther up the floor draw
// smaller, nearer things larger, and ONE comparator decides overlap. Display
// only: gameplay coordinates, collision, and interaction never see this scale.
export const FAR_Y = 210
export const FAR_SCALE = 0.82
export const NEAR_Y = 595
export const NEAR_SCALE = 1.10

/** Scale for a ground-contact y: clamped at the floor's ends, linear between. */
export function depthScale(groundY: number): number {
  if (groundY <= FAR_Y) return FAR_SCALE
  if (groundY >= NEAR_Y) return NEAR_SCALE
  return FAR_SCALE + (NEAR_SCALE - FAR_SCALE) * ((groundY - FAR_Y) / (NEAR_Y - FAR_Y))
}

export type Grounded = { anchor: Point }

/**
 * The one y-sort rule: larger ground y draws later (in front). Ties keep
 * insertion order (Array.prototype.sort is stable), so callers control
 * equal-depth layering by the order they list drawables.
 */
export function byDepth(a: Grounded, b: Grounded): number {
  return a.anchor.y - b.anchor.y
}
