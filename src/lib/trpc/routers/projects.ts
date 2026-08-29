import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { encryptPat, decryptPat } from "../../crypto/pat";
import { deriveKeys } from "../../crypto/hkdf";
import { projects, jobs } from "../../db/schema";
import { validateGitPath } from "../../git/validate";
import { runGit } from "../../git/exec";
import { gitEnvWithAskpass } from "../../git/askpass";
import {
  ensureLabels,
  getRepo,
  listUserRepos,
  parseRepoUrl,
} from "../../github/client";
import { defaultCloneDest } from "../../paths";
import { nowIso } from "../../paths";
import { getRuntime, gcWorktree } from "../../runtime";
import { protectedProcedure, router } from "../init";

function publicProject(p: typeof projects.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    rootPath: p.rootPath,
    source: p.source,
    remoteKind: p.remoteKind,
    repoOwner: p.repoOwner,
    repoName: p.repoName,
    defaultBranch: p.defaultBranch,
    pollEnabled: Boolean(p.pollEnabled),
    hasPat: Boolean(p.githubPatCiphertext),
    createdAt: p.createdAt,
  };
}

export const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(projects);
    return rows.map(publicProject);
  }),
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const p = (await ctx.db.select().from(projects).where(eq(projects.id, input.id)))[0];
    if (!p) throw new TRPCError({ code: "NOT_FOUND" });
    return publicProject(p);
  }),
  validatePath: protectedProcedure
    .input(z.object({ rootPath: z.string().min(1) }))
    .query(async ({ input }) => validateGitPath(input.rootPath)),
  openLocal: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        rootPath: z.string().min(1),
        githubPat: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const v = await validateGitPath(input.rootPath);
      if (!v.ok) throw new TRPCError({ code: "BAD_REQUEST", message: v.error ?? "invalid path" });
      const abs = path.resolve(input.rootPath);
      const existing = (await ctx.db.select().from(projects).where(eq(projects.rootPath, abs)))[0];
      if (existing) return publicProject(existing);
      const id = randomUUID();
      const now = nowIso();
      const remoteKind = v.github ? "github" : "none";
      let cipher = null,
        iv = null,
        tag = null;
      if (input.githubPat) {
        const enc = encryptPat(id, input.githubPat);
        cipher = enc.ciphertext;
        iv = enc.iv;
        tag = enc.tag;
      }
      await ctx.db.insert(projects).values({
        id,
        name: input.name,
        rootPath: abs,
        source: "local_folder",
        remoteKind,
        repoOwner: v.github?.owner ?? null,
        repoName: v.github?.repo ?? null,
        cloneUrl: v.remotes.find((r) => r.name === "origin")?.url ?? null,
        defaultBranch: v.defaultBranch ?? "main",
        githubPatCiphertext: cipher,
        githubPatIv: iv,
        githubPatTag: tag,
        pollEnabled: remoteKind === "github" && input.githubPat ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
      if (remoteKind === "github" && input.githubPat && v.github) {
        await ensureLabels(input.githubPat, v.github.owner, v.github.repo).catch(() => {});
      }
      getRuntime().schedulePoll(id);
      const row = (await ctx.db.select().from(projects).where(eq(projects.id, id)))[0]!;
      return publicProject(row);
    }),
  cloneGithub: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        repoUrl: z.string().min(1),
        destPath: z.string().optional(),
        githubPat: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const parsed = parseRepoUrl(input.repoUrl);
      const dest = path.resolve(input.destPath || defaultCloneDest(parsed.owner, parsed.repo));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const { env, cleanup } = gitEnvWithAskpass(input.githubPat);
      try {
        const r = await runGit(["clone", parsed.cloneUrl, dest], { env, timeoutMs: 300_000 });
        if (r.code !== 0) throw new TRPCError({ code: "BAD_REQUEST", message: r.stderr || "clone failed" });
      } finally {
        cleanup();
      }
      const v = await validateGitPath(dest);
      const id = randomUUID();
      const now = nowIso();
      let cipher = null,
        iv = null,
        tag = null;
      if (input.githubPat) {
        const enc = encryptPat(id, input.githubPat);
        cipher = enc.ciphertext;
        iv = enc.iv;
        tag = enc.tag;
      }
      await ctx.db.insert(projects).values({
        id,
        name: input.name,
        rootPath: dest,
        source: "github_clone",
        remoteKind: "github",
        repoOwner: parsed.owner,
        repoName: parsed.repo,
        cloneUrl: parsed.cloneUrl,
        defaultBranch: v.defaultBranch ?? "main",
        githubPatCiphertext: cipher,
        githubPatIv: iv,
        githubPatTag: tag,
        pollEnabled: input.githubPat ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
      if (input.githubPat) {
        await ensureLabels(input.githubPat, parsed.owner, parsed.repo).catch(() => {});
      }
      getRuntime().schedulePoll(id);
      const row = (await ctx.db.select().from(projects).where(eq(projects.id, id)))[0]!;
      return publicProject(row);
    }),
  listGithubRepos: protectedProcedure
    .input(z.object({ githubPat: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      let pat = input.githubPat;
      if (!pat) {
        const rows = await ctx.db.select().from(projects);
        const withPat = rows.find((p) => p.githubPatCiphertext);
        if (withPat?.githubPatCiphertext) {
          pat = decryptPat(withPat.id, {
            ciphertext: withPat.githubPatCiphertext,
            iv: withPat.githubPatIv!,
            tag: withPat.githubPatTag!,
          });
        }
      }
      if (!pat) return [];
      return listUserRepos(pat);
    }),
  rotatePat: protectedProcedure
    .input(z.object({ id: z.string(), githubPat: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const p = (await ctx.db.select().from(projects).where(eq(projects.id, input.id)))[0];
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      if (p.remoteKind !== "github") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "not a GitHub project" });
      }
      const enc = encryptPat(p.id, input.githubPat);
      await ctx.db
        .update(projects)
        .set({
          githubPatCiphertext: enc.ciphertext,
          githubPatIv: enc.iv,
          githubPatTag: enc.tag,
          pollEnabled: 1,
          updatedAt: nowIso(),
        })
        .where(eq(projects.id, p.id));
      return { ok: true };
    }),
  rewrapSecrets: protectedProcedure.mutation(async ({ ctx }) => {
    void deriveKeys();
    const rows = await ctx.db.select().from(projects);
    for (const p of rows) {
      if (!p.githubPatCiphertext) continue;
      const pat = decryptPat(p.id, {
        ciphertext: p.githubPatCiphertext,
        iv: p.githubPatIv!,
        tag: p.githubPatTag!,
      });
      const enc = encryptPat(p.id, pat);
      await ctx.db
        .update(projects)
        .set({
          githubPatCiphertext: enc.ciphertext,
          githubPatIv: enc.iv,
          githubPatTag: enc.tag,
          updatedAt: nowIso(),
        })
        .where(eq(projects.id, p.id));
    }
    return { ok: true };
  }),
  ensureLabels: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const p = (await ctx.db.select().from(projects).where(eq(projects.id, input.id)))[0];
    if (!p) throw new TRPCError({ code: "NOT_FOUND" });
    if (p.remoteKind !== "github" || !p.githubPatCiphertext || !p.repoOwner || !p.repoName) {
      return { ok: true };
    }
    const pat = decryptPat(p.id, {
      ciphertext: p.githubPatCiphertext,
      iv: p.githubPatIv!,
      tag: p.githubPatTag!,
    });
    await ensureLabels(pat, p.repoOwner, p.repoName);
    return { ok: true };
  }),
  testConnection: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const p = (await ctx.db.select().from(projects).where(eq(projects.id, input.id)))[0];
    if (!p) throw new TRPCError({ code: "NOT_FOUND" });
    if (p.remoteKind === "none") return { ok: true, remoteKind: "none" as const };
    if (!p.githubPatCiphertext || !p.repoOwner || !p.repoName) {
      return { ok: false, remoteKind: "github" as const };
    }
    const pat = decryptPat(p.id, {
      ciphertext: p.githubPatCiphertext,
      iv: p.githubPatIv!,
      tag: p.githubPatTag!,
    });
    const r = await getRepo(pat, p.repoOwner, p.repoName);
    return { ok: r.status < 400, remoteKind: "github" as const, status: r.status };
  }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        pollEnabled: z.boolean().optional(),
        defaultBranch: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const p = (await ctx.db.select().from(projects).where(eq(projects.id, input.id)))[0];
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      const poll =
        p.remoteKind === "github" && p.githubPatCiphertext
          ? input.pollEnabled === undefined
            ? p.pollEnabled
            : input.pollEnabled
              ? 1
              : 0
          : 0;
      await ctx.db
        .update(projects)
        .set({
          name: input.name ?? p.name,
          pollEnabled: poll,
          defaultBranch: input.defaultBranch ?? p.defaultBranch,
          updatedAt: nowIso(),
        })
        .where(eq(projects.id, p.id));
      return { ok: true };
    }),
  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const active = await ctx.db.select().from(jobs).where(eq(jobs.projectId, input.id));
    if (active.some((j) => !j.archivedAt && j.state === "implementation")) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "job implementing" });
    }
    for (const j of active) {
      if (!j.archivedAt) await gcWorktree(j.id);
    }
    await ctx.db.delete(jobs).where(eq(jobs.projectId, input.id));
    await ctx.db.delete(projects).where(eq(projects.id, input.id));
    return { ok: true };
  }),
});
