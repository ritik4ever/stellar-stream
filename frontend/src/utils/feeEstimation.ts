/**
 * Fee estimation utilities for Soroban stream creation.
 */

import { BASE_FEE } from "@stellar/stellar-sdk";

/**
 * Estimate the Soroban transaction fee for creating a stream.
 * Returns a conservative overestimate for display to the user.
 */
export function estimateStreamCreationFee(): {
  base: string;
  resource: string;
  total: string;
} {
  const baseStroops = Number(BASE_FEE);
  const resourceStroops = 60_000; // Conservative overestimate for Soroban contract call

  const baseXlm = baseStroops / 10_000_000;
  const resourceXlm = resourceStroops / 10_000_000;

  return {
    base: `${baseXlm.toFixed(6)} XLM`,
    resource: `${resourceXlm.toFixed(6)} XLM`,
    total: `${(baseXlm + resourceXlm).toFixed(6)} XLM`,
  };
}

/**
 * Get a human-readable fee note shown before submission.
 */
export function getFeeNote(): string {
  return "A small Soroban transaction fee (~0.001–0.01 XLM) will be charged to create this stream. Make sure your wallet has enough XLM for fees.";
}
