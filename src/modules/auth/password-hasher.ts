import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keyLen: number;
  maxmem: number;
}

const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 16384,
  r: 8,
  p: 1,
  keyLen: 64,
  maxmem: 64 * 1024 * 1024,
};

function parseEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * ScryptPasswordHasher keeps password hashing consistent while allowing
 * deployment-time parameter tuning. New hashes embed parameters so
 * existing hashes remain verifiable when defaults change.
 */
export class ScryptPasswordHasher {
  readonly algorithm = "scrypt";
  private readonly minPasswordLength = 10;
  private readonly maxPasswordLength = 256;
  private readonly params: ScryptParams;

  constructor(params: ScryptParams = DEFAULT_SCRYPT_PARAMS) {
    this.params = params;
  }

  static fromEnv(): ScryptPasswordHasher {
    const params: ScryptParams = {
      N: parseEnvNumber("PASSWORD_SCRYPT_N", DEFAULT_SCRYPT_PARAMS.N),
      r: parseEnvNumber("PASSWORD_SCRYPT_R", DEFAULT_SCRYPT_PARAMS.r),
      p: parseEnvNumber("PASSWORD_SCRYPT_P", DEFAULT_SCRYPT_PARAMS.p),
      keyLen: DEFAULT_SCRYPT_PARAMS.keyLen,
      maxmem: DEFAULT_SCRYPT_PARAMS.maxmem,
    };
    return new ScryptPasswordHasher(params);
  }

  hash(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const digest = scryptSync(password, salt, this.params.keyLen, {
      N: this.params.N,
      r: this.params.r,
      p: this.params.p,
      maxmem: this.params.maxmem,
    }).toString("hex");
    return `scrypt$${this.params.N}$${this.params.r}$${this.params.p}$${salt}$${digest}`;
  }

  verify(password: string, storedHash: string): boolean {
    const [algo, n, r, p, salt, digest] = storedHash.split("$");

    if (algo !== "scrypt") {
      return false;
    }

    if (salt && digest && n && r && p) {
      const params: ScryptParams = {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        keyLen: this.params.keyLen,
        maxmem: this.params.maxmem,
      };
      if (![params.N, params.r, params.p].every((value) => Number.isFinite(value) && value > 0)) {
        return false;
      }
      const actualDigest = scryptSync(password, salt, params.keyLen, {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: params.maxmem,
      });
      const expectedDigest = Buffer.from(digest, "hex");
      return timingSafeEqual(actualDigest, expectedDigest);
    }

    const [legacyAlgo, legacySalt, legacyDigest] = storedHash.split("$");
    if (legacyAlgo !== "scrypt" || !legacySalt || !legacyDigest) {
      return false;
    }

    const actualDigest = scryptSync(password, legacySalt, DEFAULT_SCRYPT_PARAMS.keyLen, {
      N: DEFAULT_SCRYPT_PARAMS.N,
      r: DEFAULT_SCRYPT_PARAMS.r,
      p: DEFAULT_SCRYPT_PARAMS.p,
      maxmem: DEFAULT_SCRYPT_PARAMS.maxmem,
    });
    const expectedDigest = Buffer.from(legacyDigest, "hex");
    return timingSafeEqual(actualDigest, expectedDigest);
  }

  validateStrength(password: string): boolean {
    return password.length >= this.minPasswordLength &&
      password.length <= this.maxPasswordLength &&
      /[A-Za-z]/.test(password) &&
      /\d/.test(password);
  }
}
