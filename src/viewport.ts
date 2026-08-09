import type { Point } from './engine'
import { WORLD } from './engine'

// One shared camera for rendering and input (#13). Portrait zooms into the
// central play lane; landscape fits the full shop. Both branches use
// one uniform transform, so touch and drawing cannot drift apart.
export type Viewport = {
  cssWidth: number
  cssHeight: number
  scale: number // css px per world unit
  viewWidth: number // world units visible horizontally
  viewHeight: number // world units visible vertically
  originX: number // world x at the left CSS edge (negative when wider than world)
  originY: number // world y at the top CSS edge
  dpr: number // backing-store density, capped
}

export const DPR_CAP = 2
export const PORTRAIT_LANE_WIDTH = 640

export function computeViewport(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio = 1,
  bottomReserve = 0,
): Viewport {
  const portrait = cssHeight >= cssWidth * 1.25
  const frameWidth = portrait ? PORTRAIT_LANE_WIDTH : WORLD.width
  const framedHeight = Math.max(1, cssHeight - Math.max(0, bottomReserve))
  const scale = Math.min(cssWidth / frameWidth, framedHeight / WORLD.height)
  const viewWidth = cssWidth / scale
  const viewHeight = cssHeight / scale
  const safeViewHeight = framedHeight / scale
  const extraHeight = Math.max(0, safeViewHeight - WORLD.height)
  return {
    cssWidth,
    cssHeight,
    scale,
    viewWidth,
    viewHeight,
    originX: (WORLD.width - viewWidth) / 2,
    // On a tall phone, bias the shop down into the lower thumb zone while the
    // wall remains behind the DOM HUD/ticket. Tablets that fit the whole shop
    // need no bias.
    originY: (WORLD.height - safeViewHeight) / 2 - extraHeight / 3,
    dpr: Math.min(devicePixelRatio, DPR_CAP),
  }
}

/** Backing-store pixel dimensions for the canvas element. */
export function backingSize(view: Viewport): { width: number; height: number } {
  return { width: Math.round(view.cssWidth * view.dpr), height: Math.round(view.cssHeight * view.dpr) }
}

/** Client (CSS) coordinates relative to the canvas box, to world coordinates. */
export function clientToWorld(view: Viewport, clientX: number, clientY: number): Point {
  return { x: view.originX + clientX / view.scale, y: view.originY + clientY / view.scale }
}

/** World coordinates to client (CSS) coordinates relative to the canvas box. */
export function worldToClient(view: Viewport, world: Point): Point {
  return { x: (world.x - view.originX) * view.scale, y: (world.y - view.originY) * view.scale }
}
