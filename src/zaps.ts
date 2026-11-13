import type { ParsedZap } from "@snort/system";

/**
 * A zap counts only when the receipt actually verified.
 *
 * `parseZap` sets `valid` after checking the receipt against its zap request:
 * signature, recipient, target tags and amount. A receipt that fails any of those
 * checks is still a perfectly publishable event — anyone can sign one — so
 * displaying it or adding it to a total is forgeable social proof. A signed
 * receipt whose `p` tags did not match was shown as "2K sats" and counted in
 * "Total Zaps" before this filter.
 */
export function isCountableZap(zap: ParsedZap): boolean {
  return zap.valid === true;
}

/** Sum of the receipts that verified. Unverified receipts contribute nothing. */
export function totalSats(zaps: ReadonlyArray<ParsedZap>): number {
  let total = 0;
  for (const zap of zaps) {
    if (isCountableZap(zap)) {
      total += zap.amount ?? 0;
    }
  }
  return total;
}
