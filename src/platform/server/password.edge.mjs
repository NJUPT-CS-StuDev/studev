// The edge never handles a password: sign-in and every password change run in the Node function (routes.mjs).
const nodeOnly = () => { throw new Error('Passwords are handled in the Node function.'); };
export const scrypt = nodeOnly;
export const passwordProblem = nodeOnly;
export const validatePassword = nodeOnly;
