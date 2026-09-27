import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

// Argon2id === 2 (Algorithm enum value inlined: ambient const enums cannot
// be read as values when isolatedModules is enabled).
const ARGON_OPTS = {
  algorithm: 2 as unknown as Algorithm,
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
};

/** Argon2id password hash (PHC string). Never log or audit the input or output. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  try {
    return await verify(phc, password);
  } catch {
    return false;
  }
}

let dummyHash: string | null = null;
/** Verify against a throwaway hash when the user does not exist (timing equalization). */
export async function dummyVerify(password: string): Promise<false> {
  if (!dummyHash) dummyHash = await hashPassword(cryptoRandom());
  await verifyPassword(dummyHash, password);
  return false;
}

function cryptoRandom(): string {
  return randomBytes(24).toString('hex');
}
