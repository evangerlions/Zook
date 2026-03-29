import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * DevelopmentPasswordHasher keeps the hashing concern adapterized.
 * The production binding should be swapped to Argon2id exactly as the design doc requires.
 */
export class DevelopmentPasswordHasher {
  readonly algorithm = "scrypt";

  hash(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const digest = scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${digest}`;
  }

  verify(password: string, storedHash: string): boolean {
    const [algo, salt, digest] = storedHash.split("$");
    if (algo !== "scrypt" || !salt || !digest) {
      return false;
    }

    const actualDigest = scryptSync(password, salt, 64);
    const expectedDigest = Buffer.from(digest, "hex");
    return timingSafeEqual(actualDigest, expectedDigest);
  }

  validateStrength(password: string): boolean {
    return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
  }
}
