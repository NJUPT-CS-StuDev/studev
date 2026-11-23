import { createPlatformHandler } from './app.mjs';
const handle = createPlatformHandler({ academicYear: __STUDEV_ACADEMIC_YEAR__ });
export async function onRequest(context) { return handle(context); }
