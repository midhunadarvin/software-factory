import { z } from "zod";
import { protectedProcedure, router } from "../init";
import { getAgentStatus } from "../../agents/status";
import { listAvailableModels } from "../../llm/model";
import { listModelsForJob } from "../../agents/harness/models";

export const agentRouter = router({
  status: protectedProcedure.query(async () => getAgentStatus()),
  models: protectedProcedure
    .input(z.object({ jobId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      if (input?.jobId) return listModelsForJob(input.jobId);
      return { harness: "inprocess" as const, ...(await listAvailableModels()) };
    }),
});
