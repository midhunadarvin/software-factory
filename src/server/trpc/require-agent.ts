import { TRPCError } from "@trpc/server";
import { assertAgentReady } from "../agents/status";

export async function requireAgent() {
  try {
    return await assertAgentReady();
  } catch (err) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: err instanceof Error ? err.message : "Agent is not configured",
    });
  }
}
