import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toStrandsTools, zodToJsonSchema } from "./strands-tools";
import { tool } from "./factory-tool";

describe("zodToJsonSchema", () => {
  it("describes objects, enums, defaults, and passthrough extras", () => {
    const schema = z
      .object({
        status: z.enum(["simple", "complex"]),
        note: z.string().max(500).optional(),
        depth: z.number().int().default(3),
      })
      .passthrough();
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        status: { type: "string", enum: ["simple", "complex"] },
        note: { type: "string" },
        depth: { type: "number" },
      },
      required: ["status"],
      additionalProperties: true,
    });
  });

  it("describes unions and arrays used by review artifacts", () => {
    const schema = z.object({
      version: z.union([z.number(), z.string()]).optional(),
      tasks: z.array(z.unknown()).optional(),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        version: { anyOf: [{ type: "number" }, { type: "string" }] },
        tasks: { type: "array", items: {} },
      },
    });
  });
});

describe("toStrandsTools", () => {
  it("names tools from the record keys and applies Zod defaults in the callback", async () => {
    const tools = toStrandsTools({
      listDir: tool({
        description: "List files",
        inputSchema: z.object({
          path: z.string().default("."),
          depth: z.number().int().default(3),
        }),
        execute: async (input) => input,
      }),
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("listDir");
    const result = await tools[0]!.invoke({});
    expect(result).toEqual({ path: ".", depth: 3 });
  });
});
