import { createPlatformHandler } from './app.mjs';
const handle = createPlatformHandler();
export async function onRequest(context) { return handle(context); }
