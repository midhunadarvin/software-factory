import { router } from "./init";
import { authRouter } from "./routers/auth";
import { projectsRouter } from "./routers/projects";
import { jobsRouter } from "./routers/jobs";

export const appRouter = router({
  auth: authRouter,
  projects: projectsRouter,
  jobs: jobsRouter,
});

export type AppRouter = typeof appRouter;
