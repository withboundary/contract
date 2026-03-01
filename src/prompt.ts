import {
  type ZodType,
  ZodObject,
  ZodArray,
  ZodEnum,
  ZodNativeEnum,
  ZodString,
  ZodNumber,
  ZodBoolean,
  ZodOptional,
  ZodNullable,
  ZodDefault,
  ZodLiteral,
  ZodUnion,
  ZodEffects,
} from "zod";

export function prompt(schema: ZodType): string {
  const shape = describeSchema(schema, 0);
  return [
    "Respond with valid JSON matching this structure exactly.",
    "Include all required fields.",
    "Do not include extra fields.",
    "Enum values must match exactly, including casing.",
    "Do not include any text outside the JSON. No markdown fences, no explanation.",
    "",
    shape,
  ].join("\n");
}

function describeSchema(schema: ZodType, depth: number): string {
  const indent = "  ".repeat(depth);
  const unwrapped = unwrap(schema);

  if (unwrapped instanceof ZodObject) {
    return describeObject(unwrapped, depth);
  }

  if (unwrapped instanceof ZodArray) {
    const itemDesc = describeSchema(unwrapped.element, depth + 1);
    return `${indent}array of:\n${itemDesc}`;
  }

  if (unwrapped instanceof ZodEnum) {
    const values = (unwrapped.options as string[]).map((v) => `"${v}"`).join(" | ");
    return `${indent}one of: ${values}`;
  }

  if (unwrapped instanceof ZodNativeEnum) {
    const values = Object.values(unwrapped.enum as Record<string, string | number>)
      .filter((v) => typeof v === "string")
      .map((v) => `"${v}"`)
      .join(" | ");
    return `${indent}one of: ${values}`;
  }

  if (unwrapped instanceof ZodLiteral) {
    return `${indent}exactly: ${JSON.stringify(unwrapped.value)}`;
  }

  if (unwrapped instanceof ZodUnion) {
    const options = (unwrapped.options as ZodType[])
      .map((o) => describeSchema(o, depth))
      .join(` | `);
    return options;
  }

  if (unwrapped instanceof ZodString) {
    const constraints = describeStringConstraints(unwrapped);
    return `${indent}string${constraints ? ` (${constraints})` : ""}`;
  }

  if (unwrapped instanceof ZodNumber) {
    const constraints = describeNumberConstraints(unwrapped);
    return `${indent}number${constraints ? ` (${constraints})` : ""}`;
  }

  if (unwrapped instanceof ZodBoolean) {
    return `${indent}boolean`;
  }

  return `${indent}any`;
}

function describeObject(schema: ZodObject<any>, depth: number): string {
  const indent = "  ".repeat(depth);
  const shape = schema.shape;
  const lines: string[] = [`${indent}{`];

  for (const [key, value] of Object.entries(shape)) {
    const fieldSchema = value as ZodType;
    const optional = isOptional(fieldSchema);
    const suffix = optional ? " (optional)" : "";
    const desc = describeSchema(fieldSchema, 0).trim();
    lines.push(`${indent}  "${key}": ${desc}${suffix}`);
  }

  lines.push(`${indent}}`);
  return lines.join("\n");
}

function describeStringConstraints(schema: ZodString): string {
  const checks = (schema as any)._def?.checks as Array<{ kind: string; value?: unknown; regex?: RegExp }> | undefined;
  if (!checks || checks.length === 0) {
    return "";
  }

  const parts: string[] = [];
  for (const check of checks) {
    switch (check.kind) {
      case "min":
        parts.push(`min length: ${check.value}`);
        break;
      case "max":
        parts.push(`max length: ${check.value}`);
        break;
      case "email":
        parts.push("email format");
        break;
      case "url":
        parts.push("URL format");
        break;
      case "uuid":
        parts.push("UUID format");
        break;
      case "regex":
        parts.push(`pattern: ${check.regex}`);
        break;
    }
  }

  return parts.join(", ");
}

function describeNumberConstraints(schema: ZodNumber): string {
  const checks = (schema as any)._def?.checks as Array<{ kind: string; value?: number }> | undefined;
  if (!checks || checks.length === 0) {
    return "";
  }

  const parts: string[] = [];
  for (const check of checks) {
    switch (check.kind) {
      case "min":
        parts.push(`>= ${check.value}`);
        break;
      case "max":
        parts.push(`<= ${check.value}`);
        break;
      case "int":
        parts.push("integer");
        break;
    }
  }

  return parts.join(", ");
}

function isOptional(schema: ZodType): boolean {
  if (schema instanceof ZodOptional) {
    return true;
  }
  if (schema instanceof ZodDefault) {
    return true;
  }
  return false;
}

function unwrap(schema: ZodType): ZodType {
  if (schema instanceof ZodOptional) {
    return unwrap(schema.unwrap());
  }
  if (schema instanceof ZodNullable) {
    return unwrap(schema.unwrap());
  }
  if (schema instanceof ZodDefault) {
    return unwrap(schema._def.innerType);
  }
  if (schema instanceof ZodEffects) {
    return unwrap(schema.innerType());
  }
  return schema;
}
