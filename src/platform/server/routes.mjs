// Where a platform request runs. An edge function answers in 0.1–0.2 s but may send only about 50 subrequests per
// request (measured: the 51st Blob read fails with 502); a Node function costs about 0.6 s but has no such ceiling.
// These are the requests whose Blob work is small and bounded whatever the data grows to; every other request, such as
// a listing, an export or a sign-in that checks each signed-in device, runs in Node. The budget test keeps the bound.
export const EDGE_ROUTES = new Set([
  'GET /api/platform/auth/session',
  'GET /api/platform/auth/config',
  'POST /api/platform/auth/refresh',
  'POST /api/platform/sync',
  'POST /api/platform/ai',
]);
export const edgeRoute = (method, path) => EDGE_ROUTES.has(`${method} ${path.replace(/\/+$/, '')}`);

// The edge hands a Node-bound request to /node/platform with the visitor's address, bound to the platform secret
// and a timestamp so a direct caller cannot claim another address.
export const forwardProof = (hmacHex, secret, at, address, method, path) => hmacHex(secret, `studev-forward\0${at}\0${address}\0${method}\0${path}`);
