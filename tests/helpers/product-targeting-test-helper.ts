import { createHash } from "node:crypto";

export function hashToPercentage(input: string): number {
  const hash = createHash("md5").update(input).digest("hex");
  const num = parseInt(hash.slice(0, 8), 16);
  return num % 100;
}

export function findUserIdForBucketBelow(
  threshold: number,
  salt: string,
): string {
  for (let i = 0; i < 10000; i++) {
    const userId = `user-${i}`;
    if (hashToPercentage(`${userId}${salt}`) < threshold) {
      return userId;
    }
  }

  throw new Error(`Could not find userId for bucket < ${threshold}`);
}

export function findUserIdForBucketAtOrAbove(
  threshold: number,
  salt: string,
): string {
  for (let i = 0; i < 10000; i++) {
    const userId = `user-${i}`;
    if (hashToPercentage(`${userId}${salt}`) >= threshold) {
      return userId;
    }
  }

  throw new Error(`Could not find userId for bucket >= ${threshold}`);
}
