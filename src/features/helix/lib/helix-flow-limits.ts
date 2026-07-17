/** HELIX tape paging — shared between API route and client. */

/** Default rows per page (initial load + each "Load older" click). */
export const HELIX_FLOW_PAGE_SIZE = 500;

/** Hard max rows per API request (Postgres LIMIT). */
export const HELIX_FLOW_MAX_LIMIT = 5000;

/** Default lookback window for the tape (7 days). */
export const HELIX_FLOW_DEFAULT_SINCE_HOURS = 168;

/** Max lookback the API accepts (30 days). */
export const HELIX_FLOW_MAX_SINCE_HOURS = 720;

/** Estimated row height (px) for tape virtualization. */
export const HELIX_TAPE_ROW_HEIGHT = 42;

/** Virtualizer overscan (rows above/below viewport). */
export const HELIX_TAPE_OVERSCAN = 8;
