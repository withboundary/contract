import { describe, it, expect } from "vitest";
import { z } from "zod";
import { verify } from "../src/index.js";

describe("verify", () => {
  const Schema = z.object({
    name: z.string(),
    age: z.number().min(0).max(150),
  });

  describe("valid data", () => {
    it("returns success for valid data", () => {
      const result = verify({ name: "Alice", age: 30 }, Schema);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ name: "Alice", age: 30 });
      }
    });

    it("strips extra fields via Zod", () => {
      const result = verify(
        { name: "Alice", age: 30, extra: "field" },
        Schema,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("invalid data", () => {
    it("fails when a required field is missing", () => {
      const result = verify({ name: "Alice" }, Schema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.attempts[0].issues.length).toBeGreaterThan(0);
        expect(result.error.attempts[0].issues[0]).toContain("age");
      }
    });

    it("fails when a field has wrong type", () => {
      const result = verify({ name: 123, age: 30 }, Schema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.attempts[0].issues[0]).toContain("name");
      }
    });

    it("fails when a number is out of range", () => {
      const result = verify({ name: "Alice", age: -5 }, Schema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.attempts[0].issues[0]).toContain("age");
      }
    });

    it("collects multiple issues", () => {
      const result = verify({ name: 123 }, Schema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.attempts[0].issues.length).toBe(2);
      }
    });
  });

  describe("nested schemas", () => {
    const NestedSchema = z.object({
      user: z.object({
        name: z.string(),
        address: z.object({
          city: z.string(),
        }),
      }),
    });

    it("validates nested objects", () => {
      const result = verify(
        { user: { name: "Alice", address: { city: "NYC" } } },
        NestedSchema,
      );
      expect(result.ok).toBe(true);
    });

    it("reports path for nested failures", () => {
      const result = verify(
        { user: { name: "Alice", address: { city: 123 } } },
        NestedSchema,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.attempts[0].issues[0]).toContain(
          "user.address.city",
        );
      }
    });
  });

  describe("enum schemas", () => {
    const EnumSchema = z.object({
      status: z.enum(["active", "inactive", "pending"]),
    });

    it("passes for valid enum value", () => {
      const result = verify({ status: "active" }, EnumSchema);
      expect(result.ok).toBe(true);
    });

    it("fails for invalid enum value", () => {
      const result = verify({ status: "unknown" }, EnumSchema);
      expect(result.ok).toBe(false);
    });
  });

  describe("rules", () => {
    it("passes when rules pass", () => {
      const result = verify({ name: "Alice", age: 30 }, Schema, [
        (data) => data.age >= 18 || "must be 18 or older",
      ]);
      expect(result.ok).toBe(true);
    });

    it("fails when a rule fails", () => {
      const result = verify({ name: "Alice", age: 10 }, Schema, [
        (data) => data.age >= 18 || "must be 18 or older",
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.attempts[0].issues[0]).toBe(
          "must be 18 or older",
        );
      }
    });

    it("collects multiple rule failures", () => {
      const result = verify({ name: "Alice", age: 10 }, Schema, [
        (data) => data.age >= 18 || "must be 18 or older",
        (data) => data.name.length > 10 || "name too short",
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.attempts[0].issues).toHaveLength(2);
      }
    });

    it("does not run rules when schema validation fails", () => {
      let ruleCalled = false;
      const result = verify({ name: 123 }, Schema, [
        () => {
          ruleCalled = true;
          return true;
        },
      ]);
      expect(result.ok).toBe(false);
      expect(ruleCalled).toBe(false);
    });
  });
});
