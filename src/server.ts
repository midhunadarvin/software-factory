import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { loadDotenv } from "./lib/load-dotenv";
import { loadEnv } from "./lib/env";
import { migrate } from "./lib/db/migrate";
import { getRuntime } from "./lib/runtime";

loadDotenv();
const env = loadEnv();
const dev = process.env.NODE_ENV !== "production";
const hostname = env.bindHost;
const port = env.bindPort;

migrate();
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
