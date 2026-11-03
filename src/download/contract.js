/** Transmission parameters for the published APK parts contract.
 *
 * These describe how bytes move, not what the product is, so they live here
 * rather than in product.json. Both the build (scripts/apk/package.mjs) and the
 * download worker read them from this one place.
 *
 * PART_BYTES = 6 MiB keeps the part count real: a 23.9 MB APK becomes four
 * parts, so the multi-part path runs on every release instead of only when the
 * APK happens to outgrow one part.
 *
 * CONCURRENCY = 4 comes from measurement on the current hosting. One stream is
 * throttled to roughly 0.8 MB/s while four streams reach about 6.3 MB/s, and
 * eight streams add nothing because the egress tops out around there. Four is
 * also comfortably inside the per-host connection budget a browser allows. */
export const PART_BYTES = 6 * 1024 * 1024;
export const CONCURRENCY = 4;
