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

    const [algorithm, ...fields] = storedHash.split("$");
    if (algorithm !== "scrypt" || (fields.length !== 2 && fields.length !== 5)) return false;

    const [salt, digest] = fields.slice(-2);
    if (!salt || !/^[a-f0-9]{128}$/i.test(digest)) return false;

    const [N, r, p] = fields.length === 5 ? fields.slice(0, 3).map(Number) : [16384, 8, 1];
    if (!Number.isInteger(N) || N < 2 || N > 65536 || (N & (N - 1)) !== 0 ||
      !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || N * r * p > 524288)
      return false;
    try {
      const actualDigest = scryptSync(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
      return timingSafeEqual(actualDigest, Buffer.from(digest, "hex"));
    } catch {
      return false;
    }
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
