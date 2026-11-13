/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { ParsedZap } from "@snort/system";
import { isCountableZap, totalSats } from "./zaps";

function zap(amount: number, valid: boolean): ParsedZap {
  return {
    id: "e".repeat(64),
    amount,
    zapService: "wss://relay.example",
    valid,
    errors: valid ? [] : ["p tags dont match"],
    anonZap: false,
    created_at: 1_700_000_000,
    targetEvents: [],
  };
}

describe("zap totals", () => {
  test("counts verified receipts", () => {
    expect(totalSats([zap(1000, true), zap(21, true)])).toBe(1021);
    expect(isCountableZap(zap(1, true))).toBe(true);
  });

  test("ignores a forged receipt even though it carries an amount", () => {
    // The reported fixture: a signed receipt with mismatched p tags, valid=false,
    // claiming 2000 sats. It used to be displayed and summed.
    expect(totalSats([zap(2000, false)])).toBe(0);
    expect(totalSats([zap(1000, true), zap(2000, false)])).toBe(1000);
    expect(isCountableZap(zap(2000, false))).toBe(false);
  });

  test("an unverified-only list yields no total, so the banner stays hidden", () => {
    expect(totalSats([zap(2000, false), zap(500, false)])).toBe(0);
  });

  test("treats a missing amount as zero", () => {
    const missing = { ...zap(0, true), amount: undefined } as unknown as ParsedZap;
    expect(totalSats([missing])).toBe(0);
  });
});
