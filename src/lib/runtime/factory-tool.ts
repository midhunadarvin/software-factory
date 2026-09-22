import type { z } from "zod";

/** Lane tool definition. Adapted to Strands FunctionTool at invoke time. */
export type FactoryTool<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  description: string;
  inputSchema: S;
  execute: (input: z.infer<S>) => unknown | Promise<unknown>;
};

export type FactoryToolSet = Record<string, FactoryTool>;

export function tool<S extends z.ZodTypeAny>(opts: FactoryTool<S>): FactoryTool<S> {
  return opts;
}
