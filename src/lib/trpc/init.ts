import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { allowedOrigins } from "../env";
import { verifySession, SESSION_COOKIE } from "../auth/session";
import { getDb } from "../db/client";
import { getRuntime } from "../runtime";

export type Context = {
  db: ReturnType<typeof getDb>;
  runtime: ReturnType<typeof getRuntime>;
  authenticated: boolean;
  req: Request;
};

export function createContext(opts: { req: Request }): Context {
  const cookie = opts.req.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return {
    db: getDb(),
    runtime: getRuntime(),
    authenticated: verifySession(match?.[1]),
    req: opts.req,
  };
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next, type }) => {
  if (!ctx.authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (type === "mutation") {
    const origin = ctx.req.headers.get("origin");
    if (origin && !allowedOrigins().includes(origin)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "origin not allowed" });
    }
  }
  return next({ ctx });
});
