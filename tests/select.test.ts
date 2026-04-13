import { describe, it, expect } from "vitest";
import { z } from "zod";
import { select } from "../src/utils/select.js";

describe("select", () => {
  it("picks only schema-defined keys", () => {
    const state = {
      name: "Alice",
      email: "alice@co.com",
      passwordHash: "$2b$10$abc",
      ssn: "123-45-6789",
    };
    const schema = z.object({
      name: z.string(),
      email: z.string(),
    });

    expect(select(state, schema)).toEqual({
      name: "Alice",
      email: "alice@co.com",
    });
  });

  it("drops all keys not in the schema", () => {
    const state = { a: 1, b: 2, c: 3, d: 4 };
    const schema = z.object({ a: z.number(), c: z.number() });

    const result = select(state, schema);
    expect(result).toEqual({ a: 1, c: 3 });
    expect(result).not.toHaveProperty("b");
    expect(result).not.toHaveProperty("d");
  });

  it("handles nested objects", () => {
    const state = {
      user: {
        name: "Alice",
        age: 30,
        secret: "hidden",
      },
    };
    const schema = z.object({
      user: z.object({
        name: z.string(),
      }),
    });

    expect(select(state, schema)).toEqual({
      user: { name: "Alice" },
    });
  });

  it("handles missing keys gracefully", () => {
    const state = { name: "Alice" };
    const schema = z.object({
      name: z.string(),
      email: z.string(),
    });

    expect(select(state, schema)).toEqual({ name: "Alice" });
  });

  it("returns empty object for non-object schema", () => {
    const state = { name: "Alice" };
    const schema = z.string();

    expect(select(state, schema)).toEqual({});
  });

  it("handles optional fields", () => {
    const state = {
      name: "Alice",
      bio: "Developer",
      secret: "hidden",
    };
    const schema = z.object({
      name: z.string(),
      bio: z.string().optional(),
    });

    expect(select(state, schema)).toEqual({
      name: "Alice",
      bio: "Developer",
    });
  });

  it("preserves array values without filtering", () => {
    const state = {
      tags: ["a", "b", "c"],
      extra: "hidden",
    };
    const schema = z.object({
      tags: z.array(z.string()),
    });

    expect(select(state, schema)).toEqual({
      tags: ["a", "b", "c"],
    });
  });
});
