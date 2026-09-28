import { createHash, randomBytes } from 'crypto';
export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
