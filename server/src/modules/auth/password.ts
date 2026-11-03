import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with argon2id, using Node's built-in implementation.
 *
 * Hashes are stored in the standard PHC string format, so the settings travel
 * with each hash and can be raised later without breaking old passwords:
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 */

const argon2Async = promisify(argon2);

// OWASP's recommended minimum for argon2id.
const DEFAULTS = { memory: 19_456, passes: 2, parallelism: 1 };
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const VERSION = 19;

type Params = typeof DEFAULTS;

async function derive(password: string, salt: Buffer, params: Params, length: number): Promise<Buffer> {
  return argon2Async("argon2id", {
    message: password,
    nonce: salt,
    tagLength: length,
    ...params,
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, DEFAULTS, HASH_BYTES);
  const { memory, passes, parallelism } = DEFAULTS;
  return `$argon2id$v=${VERSION}$m=${memory},t=${passes},p=${parallelism}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

const PHC_PATTERN = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/;

/** Returns false for a wrong password or a malformed hash; never throws on bad input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(stored);
  if (!match || Number(match[1]) !== VERSION) return false;

  const params = { memory: Number(match[2]), passes: Number(match[3]), parallelism: Number(match[4]) };
  const salt = Buffer.from(match[5]!, "base64url");
  const expected = Buffer.from(match[6]!, "base64url");
  let actual: Buffer;
  try {
    actual = await derive(password, salt, params, expected.length);
  } catch {
    return false; // parameters out of range, e.g. a corrupted hash
  }
  // Constant-time comparison so response timing doesn't leak how close a guess was.
  return timingSafeEqual(actual, expected);
}

/**
 * A real hash of a random password. Login checks unknown emails against it so
 * that "no such user" takes as long as "wrong password", and attackers can't
 * use timing to discover which emails have accounts.
 */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));
