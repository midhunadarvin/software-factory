import { router } from "./init";
import { authRouter } from "./routers/auth";
import { projectsRouter } from "./routers/projects";
import { jobsRouter } from "./routers/jobs";
import { agentRouter } from "./routers/agent";

export const appRouter = router({
  auth: authRouter,
  projects: projectsRouter,
  jobs: jobsRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;
