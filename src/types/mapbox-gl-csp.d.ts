/**
 * mapbox-gl's CSP build (dist/mapbox-gl-csp.js) is the same API as the main
 * entry, minus the inlined blob worker — see src/lib/security/csp.ts for why
 * the app loads it. The package ships types only for its main entry.
 */
declare module "mapbox-gl/dist/mapbox-gl-csp" {
  import mapboxgl from "mapbox-gl";
  export default mapboxgl;
}
