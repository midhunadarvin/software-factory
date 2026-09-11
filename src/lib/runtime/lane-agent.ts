import { z, type ZodTypeAny } from "zod";
import { tool } from "ai";
import { completeObject, completeText, formatLlmError, getJobModel, getModel } from "./llm";
import { finishLaneAndStop, loadTicket, ticketTools } from "./ticket";
import { repoTools } from "./repo-tools";
import {
  pickReviewArtifact,
  pullRequestDraftInputSchema,
  requestHumanReview,
  requestHumanReviewTool,
  reviewArtifactInputSchema,
  reviewReportInputSchema,
  taskGraphInputSchema,
} from "./review-tools";
import { skillFor, type LaneId } from "./skills";
import { formatContextBlock, type LaneContext } from "./context";
import { logEvent } from "./events";
import { UNTRUSTED_INSTRUCTION } from "./untrusted";
import {
  finishSession,
  getSession,
  getSessionArtifact,
  sessionWasStopped,
  setSessionArtifact,
  startSession,
  stopSession,
} from "./session-store";
import { pushStream } from "./stream";
import { parseStructured } from "./llm-parse";
import { TriageReportSchema } from "../artifacts/schemas";
import {
  coerceFunctionalRequirements,
  coercePullRequestDraft,
  coerceReviewReport,
  coerceTaskGraph,
  coerceTechnicalSpec,
} from "../artifacts/coerce";

export async function runLaneObjectAgent<S extends ZodTypeAny>(opts: {
  lane: LaneId;
  jobId: string;
  projectId: string;
  context: LaneContext | null;
  userPrompt: string;
  schema: S;
}): Promise<z.infer<S>> {
  if (!getModel(opts.jobId)) {
    throw new Error("Agent model is not configured");
  }
  startSession(opts.jobId, opts.projectId, opts.lane, getJobModel(opts.jobId));
  await logEvent({
    projectId: opts.projectId,
    jobId: opts.jobId,
    event: "lane.agent.start",
    payload: { lane: opts.lane, model: getJobModel(opts.jobId) },
  });

  try {
    const reasoning = await completeText({
      jobId: opts.jobId,
      system: [
        skillFor(opts.lane),
        UNTRUSTED_INSTRUCTION,
        opts.lane === "triage"
          ? "Inspect the repo, then setTicketStatus, setRisk, finishLane."
          : opts.lane === "requirements" || opts.lane === "tech_spec"
            ? "Call inspectRepo once if needed. Then requestHumanReview with the spec JSON. That writes the spec file, shows Approve/Reject on the ticket, and ends this session. Do not keep exploring."
            : opts.lane === "tasks"
              ? "Inspect once if needed. Call submitArtifact with a tasks array. That saves the graph, moves the ticket, and ends this session. Do not keep exploring."
              : opts.lane === "review"
                ? "gitDiff once. Call submitArtifact with summary, verdict, findings, filesChanged. Then stop. Do not retry."
              : opts.lane === "pull_request"
                ? "gitStatus once. Confirm a feature branch. Call submitArtifact with title and body that describe only the product files. Do not include .factory/ plans or specs. Then stop."
                : "Inspect the repo with inspectRepo/readFile/grep. Call submitArtifact with valid JSON, then finishLane.",
      ].join("\n\n"),
      prompt: `${formatContextBlock(opts.context)}\n\nReason through this lane task:\n${opts.userPrompt}`,
      tools: await toolsForLane(opts.jobId, opts.lane, opts.schema),
      maxSteps:
        opts.lane === "requirements" ||
        opts.lane === "tech_spec" ||
        opts.lane === "tasks" ||
        opts.lane === "review" ||
        opts.lane === "pull_request"
          ? 6
          : 28,
      onPart: (part) => {
        if (part.type === "thinking" || part.type === "text") {
          pushStream({
            jobId: opts.jobId,
            projectId: opts.projectId,
            lane: opts.lane,
            kind: "thinking",
            delta: part.delta,
          });
        } else if (part.type === "tool" && part.tool) {
          pushStream({
            jobId: opts.jobId,
            projectId: opts.projectId,
            lane: opts.lane,
            kind: "tool",
            delta: part.delta,
            tool: part.tool,
          });
        }
      },
    });
    if (getSessionArtifact(opts.jobId) == null) {
      if (opts.lane === "requirements" || opts.lane === "tech_spec") {
        const fallback =
          coerceLaneArtifact(opts.lane, { summary: reasoning.slice(0, 800) }) ?? { summary: reasoning.slice(0, 400) };
        await requestHumanReview({ jobId: opts.jobId, lane: opts.lane, artifact: fallback });
      } else if (opts.lane === "tasks") {
        const fallback = coerceTaskGraph({ summary: reasoning.slice(0, 800) });
        setSessionArtifact(opts.jobId, fallback);
        await finishLaneAndStop(opts.jobId);
      } else if (opts.lane === "pull_request") {
        setSessionArtifact(opts.jobId, coercePullRequestDraft({ title: reasoning.slice(0, 80), body: reasoning }));
      } else if (opts.lane === "review") {
        setSessionArtifact(opts.jobId, coerceReviewReport({ summary: reasoning.slice(0, 800), verdict: "approve" }));
        stopSession(opts.jobId);
      }
    }
    const fromExit = artifactFromStoppedSession(opts.lane, opts.jobId, opts.schema, reasoning);
    const skipObject =
      opts.lane === "requirements" ||
      opts.lane === "tech_spec" ||
      opts.lane === "tasks" ||
      opts.lane === "review" ||
      opts.lane === "pull_request";
    const object =
      fromExit ??
      (skipObject
        ? (coerceLaneArtifact(opts.lane, { summary: reasoning.slice(0, 400) }) as z.infer<S>)
        : await completeObject({
        jobId: opts.jobId,
        schema: opts.schema,
        system: [
          skillFor(opts.lane),
          UNTRUSTED_INSTRUCTION,
          "You are the only agent for this lane. Emit only the structured artifact.",
        ].join("\n\n"),
        prompt: `${formatContextBlock(opts.context)}\n\nYour reasoning:\n${reasoning.slice(0, 6000)}\n\nNow produce the artifact:\n${opts.userPrompt}`,
        onPart: (part) => {
          if (sessionWasStopped(opts.jobId)) return;
          pushStream({
            jobId: opts.jobId,
            projectId: opts.projectId,
            lane: opts.lane,
            kind: part.type === "tool" ? "tool" : "text",
            delta: part.delta,
            tool: part.tool,
          });
        },
      }));
    if (!sessionWasStopped(opts.jobId)) finishSession(opts.jobId, "done");
    await logEvent({
      projectId: opts.projectId,
      jobId: opts.jobId,
      event: "lane.agent.end",
      payload: { lane: opts.lane, ok: true },
    });
    return object;
  } catch (err) {
    const fallback = artifactFromStoppedSession(opts.lane, opts.jobId, opts.schema, "");
    if (fallback) {
      if (!sessionWasStopped(opts.jobId)) finishSession(opts.jobId, "done");
      await logEvent({
        projectId: opts.projectId,
        jobId: opts.jobId,
        event: "lane.agent.end",
        payload: { lane: opts.lane, ok: true, recovered: true },
      });
      return fallback;
    }
    const message = formatLlmError(err);
    finishSession(opts.jobId, "error", message);
    await logEvent({
      projectId: opts.projectId,
      jobId: opts.jobId,
      level: "error",
      event: "lane.agent.end",
      payload: { lane: opts.lane, ok: false, error: message },
    });
    throw err;
  }
}

async function toolsForLane(jobId: string, lane: LaneId, schema: ZodTypeAny) {
  const job = await loadTicket(jobId);
  const worktree = job?.worktreePath;
  const coding =
    worktree &&
    repoTools(worktree, {
      write: lane === "implementation",
      exec: lane === "implementation",
    });
  return {
    ...ticketTools(jobId),
    ...(coding ?? {}),
    ...(lane === "requirements" || lane === "tech_spec" ? requestHumanReviewTool(jobId, lane) : {}),
    submitArtifact: tool({
      description:
        lane === "requirements" || lane === "tech_spec"
          ? "Same as requestHumanReview: write the spec and park the ticket for Approve/Reject."
          : lane === "tasks"
            ? "Save the task graph and move the ticket to implementation. Pass tasks: [{ id: T-1, title, files, dependsOn, acceptance }]. Then stop."
            : lane === "review"
              ? "Save the review. Pass summary, verdict (approve|request_changes), findings, filesChanged at the top level. Then stop."
            : lane === "pull_request"
              ? "Save the pull request title and markdown body for the product change only. Do not include .factory/ plans or specs. Pass title and body directly. Then stop."
            : "Submit the finished structured artifact for this lane. Required before finishLane. Pass the full JSON object.",
      inputSchema:
        lane === "requirements" || lane === "tech_spec"
          ? reviewArtifactInputSchema
          : lane === "tasks"
            ? taskGraphInputSchema
            : lane === "review"
              ? reviewReportInputSchema
            : lane === "pull_request"
              ? pullRequestDraftInputSchema
              : z.object({ artifact: z.unknown() }),
      execute: async (input) => {
        const artifact = pickReviewArtifact(input);
        if (lane === "requirements" || lane === "tech_spec") {
          return requestHumanReview({ jobId, lane, artifact });
        }
        const coerced = coerceLaneArtifact(lane, artifact);
        const parsed = coerced != null ? schema.safeParse(coerced) : schema.safeParse(artifact);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.issues.slice(0, 8) };
        }
        setSessionArtifact(jobId, parsed.data);
        if (lane === "tasks") {
          const done = await finishLaneAndStop(jobId);
          return { submitted: true, ...done };
        }
        if (lane === "review" || lane === "pull_request") {
          stopSession(jobId);
          return { ok: true, submitted: true, session: "stopped" as const };
        }
        return { ok: true, submitted: true };
      },
    }),
  };
}

function coerceLaneArtifact(lane: LaneId, raw: unknown): unknown {
  if (lane === "tech_spec") return coerceTechnicalSpec(raw);
  if (lane === "requirements") return coerceFunctionalRequirements(raw);
  if (lane === "tasks") return coerceTaskGraph(raw);
  if (lane === "pull_request") return coercePullRequestDraft(raw);
  if (lane === "review") return coerceReviewReport(raw);
  return raw;
}

function artifactFromStoppedSession<S extends ZodTypeAny>(
  lane: LaneId,
  jobId: string,
  schema: S,
  reasoning: string,
): z.infer<S> | null {
  const stored = getSessionArtifact(jobId);
  if (stored != null) {
    const parsed = schema.safeParse(stored);
    if (parsed.success) return parsed.data;
    const coerced = coerceLaneArtifact(lane, stored);
    if (coerced) {
      const again = schema.safeParse(coerced);
      if (again.success) return again.data;
    }
  }
  const s = getSession(jobId);
  const blob = `${s?.text ?? ""}\n${reasoning}`.trim();
  const parsed = parseStructured(blob, schema);
  if (parsed.ok) return parsed.value;
  const recovered = parseStructured(blob, z.record(z.unknown()));
  if (recovered.ok) {
    const coerced = coerceLaneArtifact(lane, recovered.value);
    if (coerced) {
      const again = schema.safeParse(coerced);
      if (again.success) return again.data;
    }
  }
  if (lane === "tech_spec") {
    const spec = coerceTechnicalSpec({
      summary: (s?.thinking || reasoning || "Spec for the ticket.").slice(0, 400),
    });
    if (spec) return schema.parse(spec);
  }
  if (lane === "triage") {
    const risk = s?.risk ?? "medium";
    const classification = s?.classification ?? (risk === "low" ? "simple" : "complex");
    const built = TriageReportSchema.safeParse({
      version: 1,
      classification,
      risk,
      rationale: (s?.thinking || reasoning || "Triaged.").slice(0, 4000),
      affectedAreas: [],
      fastTrack: classification === "simple" && risk === "low",
    });
    if (built.success) return schema.parse(built.data);
  }
  return null;
}
