import { protectedProcedure, router } from "../init";
import { getAgentStatus } from "../../runtime/agent-status";
import { listAvailableModels } from "../../runtime/llm";

export const agentRouter = router({
  status: protectedProcedure.query(async () => getAgentStatus()),
  models: protectedProcedure.query(async () => listAvailableModels()),
});
