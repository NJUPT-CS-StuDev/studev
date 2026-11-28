// The edge never checks a password: sign-in and password changes run in the Node function (routes.mjs).
export async function scrypt() { throw new Error('Passwords are checked in the Node function.'); }
