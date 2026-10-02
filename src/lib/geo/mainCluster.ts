/**
 * Which facilities the dashboard map opens on, and which it leaves off.
 *
 * Real organizations are not evenly spread. One has two buildings on the
 * Saanich Peninsula and a test centre in Edmonton: fitting all three zooms out
 * to half of Western Canada and the two real pins merge into one. So the map
 * opens on the "main cluster" — every facility within MAIN_CLUSTER_RADIUS_KM of
 * the median facility — and the rest are offered as off-map chips that fly to
 * them. "Show all" still fits everything, explicitly.
 *
 * The median (per axis) rather than the mean, so one outlier cannot drag the
 * centre away from where most of the buildings are.
 *
 * Pure — no map library here, so it can be checked on its own.
 */

/** How far from the median facility a building may be and still be in the opening view. */
export const MAIN_CLUSTER_RADIUS_KM = 150;

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Splits located facilities into the opening view (`main`) and the rest
 * (`far`). Order within each half follows the input.
 *
 * With an even count the median can sit between two far-apart groups and
 * leave everything "far". When that happens the cluster is anchored on the
 * facility with the most neighbours inside the radius (ties to the one
 * nearest the median), so the map opens on the densest group rather than on
 * whichever lone building happens to be closest to an empty middle — and
 * `main` is never empty while there is input.
 */
export function splitMainCluster<T extends LatLng>(
  points: T[],
  radiusKm: number = MAIN_CLUSTER_RADIUS_KM
): { main: T[]; far: T[] } {
  if (points.length === 0) return { main: [], far: [] };

  const centre: LatLng = {
    lat: median(points.map((p) => p.lat)),
    lng: median(points.map((p) => p.lng)),
  };

  let main = points.filter((p) => distanceKm(p, centre) <= radiusKm);
  if (main.length === 0) {
    const around = (a: T) => points.filter((p) => distanceKm(p, a) <= radiusKm);
    let best = { anchor: points[0], count: around(points[0]).length };
    for (const p of points.slice(1)) {
      const count = around(p).length;
      if (
        count > best.count ||
        (count === best.count && distanceKm(p, centre) < distanceKm(best.anchor, centre))
      ) {
        best = { anchor: p, count };
      }
    }
    main = around(best.anchor);
  }
  const inMain = new Set(main);
  return { main, far: points.filter((p) => !inMain.has(p)) };
}

/** [[west, south], [east, north]] around the points. */
export function boundsOf(points: LatLng[]): [[number, number], [number, number]] {
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
