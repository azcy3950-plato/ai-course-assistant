declare module "d3-force-3d" {
  type Force<T> = ((alpha: number) => void) & { initialize(nodes: T[], ...args: unknown[]): void; strength(value: number): Force<T> };
  export function forceX<T>(value: (node: T) => number): Force<T>;
  export function forceY<T>(value: (node: T) => number): Force<T>;
  export function forceZ<T>(value: (node: T) => number): Force<T>;
}
