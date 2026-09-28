export type PetPosition = {x: number; y: number};
export type PetViewport = {width: number; height: number};
export type PetObstacle = {left: number; top: number; right: number; bottom: number};
export const petSizeFor = (width: number) => width <= 760 ? 84 : 100;
export function boundPet(position: PetPosition, viewport: PetViewport): PetPosition {
  const size = petSizeFor(viewport.width);
  const bottom = Math.max(8, viewport.height - size - 8);
  return {x: Math.max(8, Math.min(Math.max(8, viewport.width - size - 8), position.x)), y: Math.max(Math.min(64, bottom), Math.min(bottom, position.y))};
}
export const defaultPetPosition = (viewport: PetViewport) => boundPet({x: viewport.width - petSizeFor(viewport.width) - 24, y: viewport.height - petSizeFor(viewport.width) - 144}, viewport);

/** A short stroll stays near its anchor and never crosses an input or button. */
export function petWalkTarget(position: PetPosition, viewport: PetViewport, obstacles: PetObstacle[]): PetPosition | null {
  const size = petSizeFor(viewport.width);
  const step = Math.min(64, viewport.width * .16);
  for (const delta of [{x: -step, y: 0}, {x: step, y: 0}, {x: 0, y: -40}]) {
    const target = boundPet({x: position.x + delta.x, y: position.y + delta.y}, viewport);
    if (Math.hypot(target.x - position.x, target.y - position.y) < 24) continue;
    const sweep = {left: Math.min(position.x, target.x), right: Math.max(position.x, target.x) + size, top: Math.min(position.y, target.y), bottom: Math.max(position.y, target.y) + size};
    if (!obstacles.some(rect => sweep.left < rect.right + 5 && sweep.right > rect.left - 5 && sweep.top < rect.bottom + 5 && sweep.bottom > rect.top - 5)) return target;
  }
  return null;
}
