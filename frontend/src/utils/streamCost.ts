export function estimateStreamCost(amount: number, durationDays: number): { xlm: number; usdc: number } {
  const feeXlm = 0.00002 * durationDays; // Base Stellar fee per day
  const totalXlm = feeXlm + (amount / 10_000_000);
  return { xlm: Math.round(totalXlm * 1e7) / 1e7, usdc: Math.round(amount / 1e7 * 100) / 100 };
}
