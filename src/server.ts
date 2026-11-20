import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { loadDotenv } from "./utils/load-dotenv";
import { loadEnv } from "./utils/env";
import { getStore } from "./server/data";
import { getRuntime } from "./server/runtime";

loadDotenv();
const env = loadEnv();
const dev = process.env.NODE_ENV !== "production";
const hostname = env.bindHost;
const port = env.bindPort;

await getStore().migrate();
const runtime = getRuntime();
await runtime.start();

const app = next({ dev, hostname, port, dir: process.cwd() });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => {
  const parsed = parse(req.url ?? "/", true);
  void handle(req, res, parsed);
});

server.listen(port, hostname, () => {
  console.log(`Software Factory http://${hostname}:${port}`);
});

const shutdown = async () => {
  await runtime.stop();
  server.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
