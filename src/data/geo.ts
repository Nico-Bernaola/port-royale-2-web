/**
 * Map projection shared by the world builder (scripts/geo) and the game: an equirectangular
 * projection of the Caribbean, scaled by cos(20°) so shapes keep their proportions.
 */
export const GEO = {
  lonMin: -98.5,
  lonMax: -57.0,
  latMin: 6.0,
  latMax: 33.5,
  /** map pixels per degree of latitude */
  scale: 120,
  /** map pixels per navigation cell */
  navCell: 4,
} as const;

const K = Math.cos((20 * Math.PI) / 180);

export const MAP_W = Math.round((GEO.lonMax - GEO.lonMin) * K * GEO.scale);
export const MAP_H = Math.round((GEO.latMax - GEO.latMin) * GEO.scale);

export function project(lon: number, lat: number): [number, number] {
  return [(lon - GEO.lonMin) * K * GEO.scale, (GEO.latMax - lat) * GEO.scale];
}

export function unproject(x: number, y: number): [number, number] {
  return [x / (K * GEO.scale) + GEO.lonMin, GEO.latMax - y / GEO.scale];
}
