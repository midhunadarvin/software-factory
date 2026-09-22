import { tool, type JSONSchema, type JSONValue } from "@strands-agents/sdk";
import type { z } from "zod";
import type { FactoryToolSet } from "./factory-tool";

type ZodDef = { typeName?: string; [key: string]: unknown };

function defOf(schema: z.ZodTypeAny): ZodDef {
  return (schema as unknown as { _def: ZodDef })._def ?? {};
}

function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean } {
  let inner = schema;
  let optional = false;
  for (let i = 0; i < 12; i++) {
    const typeName = defOf(inner).typeName;
    if (typeName === "ZodOptional" || typeName === "ZodDefault" || typeName === "ZodNullable") {
      optional = true;
      inner = defOf(inner).innerType as z.ZodTypeAny;
      continue;
    }
    if (typeName === "ZodEffects") {
      inner = (defOf(inner).schema as z.ZodTypeAny) ?? inner;
      continue;
    }
    break;
  }
  return { inner, optional };
}

/** Zod 3 → JSON Schema for Strands FunctionTool (avoids Zod 4 `z.toJSONSchema`). */
export function zodToJsonSchema(schema: z.ZodTypeAny): JSONSchema {
  const { inner } = unwrap(schema);
  const def = defOf(inner);
  switch (def.typeName) {
    case "ZodObject": {
      const shapeRaw = def.shape;
      const shape =
        typeof shapeRaw === "function"
          ? (shapeRaw as () => Record<string, z.ZodTypeAny>)()
          : ((shapeRaw as Record<string, z.ZodTypeAny> | undefined) ?? {});
      const properties: Record<string, JSONSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!unwrap(value).optional) required.push(key);
      }
      const unknownKeys = def.unknownKeys;
      const catchallName = def.catchall ? defOf(def.catchall as z.ZodTypeAny).typeName : undefined;
      const extra = unknownKeys === "passthrough" || catchallName === "ZodUnknown" || catchallName === "ZodAny";
      return {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        ...(extra ? { additionalProperties: true } : {}),
      };
    }
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: (def.values as string[]) ?? [] };
    case "ZodNativeEnum": {
      const values = Object.values((def.values as Record<string, string | number>) ?? {}).filter(
        (v) => typeof v === "string" || typeof v === "number",
      );
      return { enum: values };
    }
    case "ZodLiteral": {
      const value = def.value as string | number | boolean;
      return { enum: [value] };
    }
    case "ZodArray":
      return { type: "array", items: zodToJsonSchema(def.type as z.ZodTypeAny) };
    case "ZodTuple": {
      const items = ((def.items as z.ZodTypeAny[]) ?? []).map((item) => zodToJsonSchema(item));
      return { type: "array", items: items.length === 1 ? items[0] : { anyOf: items } };
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = (def.options as z.ZodTypeAny[] | Map<string, z.ZodTypeAny> | undefined) ?? [];
      const list = Array.isArray(options) ? options : [...options.values()];
      return { anyOf: list.map((option) => zodToJsonSchema(option)) };
    }
    case "ZodRecord":
      return { type: "object", additionalProperties: true };
    case "ZodUnknown":
    case "ZodAny":
      return {};
    default:
      return { type: "object" };
  }
}

function asJson(value: unknown): JSONValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JSONValue;
  } catch {
    return String(value);
  }
}

export function toStrandsTools(tools?: FactoryToolSet) {
  if (!tools) return [];
  return Object.entries(tools).map(([name, factoryTool]) =>
    tool({
      name,
      description: factoryTool.description || name,
      inputSchema: zodToJsonSchema(factoryTool.inputSchema),
      callback: async (input) => {
        const parsed = factoryTool.inputSchema.safeParse(input ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.issues.slice(0, 8) };
        }
        return asJson(await factoryTool.execute(parsed.data));
      },
    }),
  );
}
