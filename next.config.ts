import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "better-sqlite3",
    "@langchain/langgraph-checkpoint-sqlite",
  ],
};

export default nextConfig;
