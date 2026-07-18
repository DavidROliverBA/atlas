/**
 * ULID generation (Crockford base32, 48-bit time + 80-bit randomness).
 *
 * Identity is stable for the life of an object (Architecture Principle 5),
 * so IDs are only ever assigned at creation and never regenerated.
 *
 * The factory takes injectable `now`/`random` sources so tests and the
 * golden-file serialisation suite can produce fully deterministic IDs.
 */

export type Ulid = string;

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_REGEX.test(value);
}

export interface UlidFactory {
  next(): Ulid;
}

export interface UlidFactoryOptions {
  now?: () => number;
  /** Returns a float in [0, 1). Defaults to crypto-backed randomness. */
  random?: () => number;
}

function defaultRandom(): () => number {
  const crypto = (globalThis as { crypto?: { getRandomValues(buf: Uint32Array): unknown } }).crypto;
  if (crypto?.getRandomValues) {
    return () => {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return (buf[0] ?? 0) / 0x1_0000_0000;
    };
  }
  return Math.random;
}

function encodeTime(time: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % 32;
    out = ENCODING[mod] + out;
    time = (time - mod) / 32;
  }
  return out;
}

function encodeRandom(random: () => number): number[] {
  const digits: number[] = [];
  for (let i = 0; i < RANDOM_LEN; i++) {
    digits.push(Math.floor(random() * 32));
  }
  return digits;
}

/**
 * Monotonic ULID factory: IDs generated within the same millisecond
 * increment the random component, so sort order matches creation order.
 */
export function ulidFactory(options: UlidFactoryOptions = {}): UlidFactory {
  const now = options.now ?? Date.now;
  const random = options.random ?? defaultRandom();

  let lastTime = -1;
  let lastRandom: number[] = [];

  return {
    next(): Ulid {
      let time = now();
      if (time <= lastTime) {
        time = lastTime;
        // Increment the random component (base-32 digits, little churn).
        const digits = [...lastRandom];
        let i = digits.length - 1;
        while (i >= 0) {
          const digit = (digits[i] ?? 0) + 1;
          if (digit < 32) {
            digits[i] = digit;
            break;
          }
          digits[i] = 0;
          i--;
        }
        if (i < 0) {
          // Random component overflowed; bump time forward.
          time = lastTime + 1;
          lastRandom = encodeRandom(random);
        } else {
          lastRandom = digits;
        }
      } else {
        lastRandom = encodeRandom(random);
      }
      lastTime = time;
      return encodeTime(time) + lastRandom.map((d) => ENCODING[d]).join("");
    },
  };
}

/** A deterministic factory for tests and fixture generation. */
export function seededUlidFactory(seed = 1, startTime = 1_700_000_000_000): UlidFactory {
  let state = seed >>> 0;
  const random = () => {
    // xorshift32 — stable across platforms.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
  let tick = 0;
  return ulidFactory({ now: () => startTime + tick++, random });
}
