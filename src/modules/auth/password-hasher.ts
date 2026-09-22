import { scryptSync, timingSafeEqual } from "node:crypto";
import { hashSync, verifySync, Algorithm } from "@node-rs/argon2";

/**
 * PasswordHasher - 使用 Argon2id 进行密码哈希
 * 向后兼容：支持验证旧的 scrypt 哈希
 */
export class PasswordHasher {
  readonly algorithm = "argon2id";
  private readonly minPasswordLength = 8;
  private readonly maxPasswordLength = 64;

  hash(password: string): string {
    return hashSync(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 65536, // 64MB
      timeCost: 3,
      parallelism: 1,
    });
  }

  verify(password: string, storedHash: string): boolean {
    // 新格式：argon2id
    if (storedHash.startsWith("$argon2id$")) {
      try {
        return verifySync(storedHash, password);
      } catch {
        return false;
      }
    }

    // 旧格式：scrypt$<salt>$<digest>
    const [algo, salt, digest] = storedHash.split("$");
    if (algo !== "scrypt" || !salt || !digest) {
      return false;
    }

    const actualDigest = scryptSync(password, salt, 64);
    const expectedDigest = Buffer.from(digest, "hex");
    return timingSafeEqual(actualDigest, expectedDigest);
  }

  validateStrength(password: string): boolean {
    return password.length >= this.minPasswordLength &&
      password.length <= this.maxPasswordLength &&
      /[A-Za-z]/.test(password) &&
      /\d/.test(password);
  }

  /**
   * 检查是否可以验证指定算法的哈希
   */
  canVerify(algo: string): boolean {
    return ["argon2id", "scrypt", "argon2id-adapter"].includes(algo);
  }
}

/** Backward-compatible name used by existing auth flow adapters and tests. */
export class DevelopmentPasswordHasher extends PasswordHasher {}
