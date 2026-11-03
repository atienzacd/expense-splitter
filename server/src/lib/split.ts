/**
 * Splitting an expense between group members.
 *
 * All amounts are whole centavos (₱150.75 → 15075). Every split function
 * returns shares that add up to exactly the expense total — no centavo is
 * ever lost or created by rounding.
 */

export type Share = { userId: string; amountOwed: number };
export type PercentageShare = { userId: string; percent: number };

export class SplitError extends Error {
  override name = "SplitError";
}

const BASIS_POINTS_IN_100_PERCENT = 10_000;

function assertPositiveCentavos(amount: number, label: string): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new SplitError(`${label} must be a positive whole number of centavos`);
  }
}

function assertUniqueUsers(userIds: string[]): void {
  if (userIds.length === 0) {
    throw new SplitError("An expense must be split between at least one person");
  }
  if (new Set(userIds).size !== userIds.length) {
    throw new SplitError("Each person can appear only once in a split");
  }
}

/**
 * Distributes `total` proportionally to `weights` using the largest remainder
 * method: everyone gets the rounded-down share, then the leftover centavos go
 * to the largest fractional remainders (ties go to whoever is listed first).
 * BigInt keeps `total * weight` exact even for very large amounts.
 */
function allocate(total: number, weights: number[]): number[] {
  const bigTotal = BigInt(total);
  const bigWeights = weights.map((w) => BigInt(w));
  const weightSum = bigWeights.reduce((sum, w) => sum + w, 0n);

  const shares = bigWeights.map((w) => (bigTotal * w) / weightSum);
  const allocated = shares.reduce((sum, s) => sum + s, 0n);
  const leftover = Number(bigTotal - allocated);

  const byRemainder = bigWeights
    .map((w, index) => ({ index, remainder: (bigTotal * w) % weightSum }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );

  for (const { index } of byRemainder.slice(0, leftover)) {
    shares[index] = shares[index]! + 1n;
  }
  return shares.map(Number);
}

/** Everyone pays the same; leftover centavos go to the first people listed. */
export function splitEqually(total: number, userIds: string[]): Share[] {
  assertPositiveCentavos(total, "Total");
  assertUniqueUsers(userIds);

  const amounts = allocate(total, userIds.map(() => 1));
  return userIds.map((userId, i) => ({ userId, amountOwed: amounts[i]! }));
}

/** Each person's amount is given explicitly and must add up to the total. */
export function splitExact(total: number, shares: Share[]): Share[] {
  assertPositiveCentavos(total, "Total");
  assertUniqueUsers(shares.map((s) => s.userId));
  for (const share of shares) {
    assertPositiveCentavos(share.amountOwed, `Amount for ${share.userId}`);
  }

  const sum = shares.reduce((acc, s) => acc + s.amountOwed, 0);
  if (sum !== total) {
    throw new SplitError(`Exact amounts add up to ${sum}, but the total is ${total}`);
  }
  return shares.map(({ userId, amountOwed }) => ({ userId, amountOwed }));
}

function toBasisPoints(percent: number, userId: string): number {
  const basisPoints = Math.round(percent * 100);
  if (!Number.isFinite(percent) || Math.abs(basisPoints - percent * 100) > 1e-6) {
    throw new SplitError(`Percentage for ${userId} can have at most 2 decimal places`);
  }
  if (basisPoints <= 0) {
    throw new SplitError(`Percentage for ${userId} must be greater than 0`);
  }
  return basisPoints;
}

/** Each person pays a percentage (up to 2 decimals); percentages must total 100. */
export function splitByPercentage(total: number, shares: PercentageShare[]): Share[] {
  assertPositiveCentavos(total, "Total");
  assertUniqueUsers(shares.map((s) => s.userId));

  const basisPoints = shares.map((s) => toBasisPoints(s.percent, s.userId));
  const sum = basisPoints.reduce((acc, bp) => acc + bp, 0);
  if (sum !== BASIS_POINTS_IN_100_PERCENT) {
    throw new SplitError(`Percentages add up to ${sum / 100}%, but must add up to 100%`);
  }

  const amounts = allocate(total, basisPoints);
  return shares.map(({ userId }, i) => ({ userId, amountOwed: amounts[i]! }));
}
