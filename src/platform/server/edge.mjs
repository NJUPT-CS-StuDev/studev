// The platform as an edge function: every API request is answered at the edge node that received it.
import { createPlatformHandler } from './app.mjs';
import { bindScrypt } from './scrypt.edge.mjs';

const handle = createPlatformHandler({ academicYear: __STUDEV_ACADEMIC_YEAR__ });
export async function onRequest(context) {
  bindScrypt(context.env || {});
  return handle(context);
}
