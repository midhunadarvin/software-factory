import { isLocked, recordFailure, recordSuccess } from "@/utils/auth/lockout";
import { cookieHeader, issueSession, passwordsMatch } from "@/utils/auth/session";
import { loadEnv } from "@/utils/env";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (isLocked(ip)) return Response.json({ error: "locked out" }, { status: 429 });
  const body = (await req.json()) as { password?: string };
  if (!passwordsMatch(body.password ?? "", loadEnv().appPassword)) {
    recordFailure(ip);
    return Response.json({ error: "invalid password" }, { status: 401 });
  }
  recordSuccess(ip);
  const secure = new URL(req.url).protocol === "https:";
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieHeader(issueSession(), secure),
    },
  });
}
