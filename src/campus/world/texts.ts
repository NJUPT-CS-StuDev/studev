import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** The existing released text key. AI reads this exact key; authored paths and public links stay unchanged. */
export const textKey = (id: string) => /^[0-9a-f]{16}$/.test(id) ? id : bytesToHex(sha256(new TextEncoder().encode(id))).slice(0, 16);
