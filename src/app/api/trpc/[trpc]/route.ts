import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "@/lib/trpc/init";
import { appRouter } from "@/lib/trpc/router";

export const runtime = "nodejs";

const handler = async (req: Request) => {
  let setCookie: string | undefined;
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ req }),
    responseMeta({ data }) {
      const first = Array.isArray(data) ? data[0] : data;
      const result = (first as { result?: { data?: { cookie?: string } } } | undefined)?.result
        ?.data;
      if (result && typeof result === "object" && "cookie" in result && result.cookie) {
        setCookie = result.cookie as string;
      }
      return {};
    },
  });
  if (setCookie) {
    const headers = new Headers(res.headers);
    headers.append("Set-Cookie", setCookie);
    return new Response(res.body, { status: res.status, headers });
  }
  return res;
};

export { handler as GET, handler as POST };
