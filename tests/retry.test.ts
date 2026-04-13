import { describe, it, expect } from "vitest";
import {
  computeRetryDelay,
  DEFAULT_RETRY_POLICY,
  resolveRetryPolicy,
} from "../src/engine/retry.js";

describe("resolveRetryPolicy", () => {
  it("returns defaults when no options given", () => {
    expect(resolveRetryPolicy()).toEqual(DEFAULT_RETRY_POLICY);
  });

  it("overrides maxAttempts", () => {
    expect(resolveRetryPolicy({ maxAttempts: 5 }).maxAttempts).toBe(5);
  });

  it("overrides backoff", () => {
    expect(resolveRetryPolicy({ backoff: "exponential" }).backoff).toBe(
      "exponential",
    );
  });

  it("overrides baseMs", () => {
    expect(resolveRetryPolicy({ baseMs: 500 }).baseMs).toBe(500);
  });
});

describe("computeRetryDelay", () => {
  it("returns 0 for first attempt", () => {
    expect(
      computeRetryDelay(1, { maxAttempts: 3, backoff: "exponential", baseMs: 200 }),
    ).toBe(0);
  });

  it("returns 0 for 'none' backoff", () => {
    expect(
      computeRetryDelay(3, { maxAttempts: 3, backoff: "none", baseMs: 200 }),
    ).toBe(0);
  });

  it("computes linear backoff", () => {
    const policy = { maxAttempts: 5, backoff: "linear" as const, baseMs: 100 };
    expect(computeRetryDelay(2, policy)).toBe(100);
    expect(computeRetryDelay(3, policy)).toBe(200);
    expect(computeRetryDelay(4, policy)).toBe(300);
  });

  it("computes exponential backoff", () => {
    const policy = { maxAttempts: 5, backoff: "exponential" as const, baseMs: 100 };
    expect(computeRetryDelay(2, policy)).toBe(100);
    expect(computeRetryDelay(3, policy)).toBe(200);
    expect(computeRetryDelay(4, policy)).toBe(400);
  });
});
