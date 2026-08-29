import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../init";
import { loadEnv } from "../../env";
import { isLocked, recordFailure, recordSuccess } from "../../auth/lockout";
import {
  cookieHeader,
  clearCookieHeader,
  issueSession,
  passwordsMatch,
} from "../../auth/session";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ({ authenticated: ctx.authenticated })),
  login: publicProcedure
    .input(z.object({ password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx.req);
      if (isLocked(ip)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "locked out" });
      }
      if (!passwordsMatch(input.password, loadEnv().appPassword)) {
        recordFailure(ip);
        throw new TRPCError({ code: "UNAUTHORIZED", message: "invalid password" });
      }
      recordSuccess(ip);
      const token = issueSession();
      const secure = new URL(ctx.req.url).protocol === "https:";
      return { ok: true as const, cookie: cookieHeader(token, secure) };
    }),
  logout: publicProcedure.mutation(() => ({ cookie: clearCookieHeader() })),
});
