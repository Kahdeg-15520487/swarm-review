/**
 * Agent session factory for isolated reviewer sessions.
 */

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Finding, Severity, ReviewCategory, TokenUsage } from "./types.js";

function createReportFindingTool(category: ReviewCategory) {
  const findings: Finding[] = [];

  const tool = defineTool({
    name: "report_finding",
    label: "Report Finding",
    description: "Report a code review finding. Call this for each issue you discover.",
    parameters: Type.Object({
      severity: Type.Union([
        Type.Literal("critical"),
        Type.Literal("warning"),
        Type.Literal("suggestion"),
      ], { description: "Severity level of the finding" }),
      title: Type.String({ description: "Short, specific title for the issue" }),
      description: Type.String({ description: "Detailed description of the issue" }),
      file: Type.String({ description: "File path where the issue is found" }),
      line: Type.Optional(Type.Number({ description: "Line number (if known)" })),
      codeSnippet: Type.Optional(Type.String({ description: "Relevant code snippet" })),
      recommendation: Type.String({ description: "How to fix the issue" }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      const finding: Finding = {
        severity: params.severity as Severity,
        category,
        title: params.title,
        description: params.description,
        file: params.file,
        line: params.line,
        codeSnippet: params.codeSnippet,
        recommendation: params.recommendation,
      };
      findings.push(finding);
      return {
        content: [{ type: "text" as const, text: `Finding recorded: [${finding.severity}] ${finding.title}` }],
        details: {},
      };
    },
  });

  return { tool, findings: () => [...findings] };
}

export interface CoordinatorReview {
  verdict: "approved" | "approved_with_comments" | "minor_issues" | "significant_concerns";
  findings: Finding[];
  summary: string;
}

function createSubmitReviewTool() {
  let review: CoordinatorReview | null = null;

  const tool = defineTool({
    name: "submit_review",
    label: "Submit Review",
    description: "Submit the final consolidated review. Call this ONCE after analyzing all reviewer findings.",
    parameters: Type.Object({
      verdict: Type.Union([
        Type.Literal("approved"),
        Type.Literal("approved_with_comments"),
        Type.Literal("minor_issues"),
        Type.Literal("significant_concerns"),
      ], { description: "Overall review verdict" }),
      summary: Type.String({ description: "Summary of the review (2-4 sentences)" }),
      findings: Type.Array(Type.Object({
        severity: Type.Union([
          Type.Literal("critical"),
          Type.Literal("warning"),
          Type.Literal("suggestion"),
        ]),
        category: Type.Union([
          Type.Literal("security"),
          Type.Literal("performance"),
          Type.Literal("quality"),
        ]),
        title: Type.String(),
        description: Type.String(),
        file: Type.String(),
        line: Type.Optional(Type.Number()),
        codeSnippet: Type.Optional(Type.String()),
        recommendation: Type.String(),
      }), { description: "Deduplicated, final findings" }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      review = {
        verdict: params.verdict as CoordinatorReview["verdict"],
        findings: params.findings as Finding[],
        summary: params.summary,
      };
      return {
        content: [{ type: "text" as const, text: `Review submitted: ${params.verdict}` }],
        details: {},
        terminate: true,
      };
    },
  });

  return { tool, review: () => review };
}


export interface SessionOptions {
  systemPrompt: string;
  category: ReviewCategory | "coordinator";
  cwd: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
}

/** Create an isolated agent session for a reviewer or coordinator. */
export async function createReviewerSession(options: SessionOptions) {
  const { systemPrompt, category, cwd, model, provider, thinkingLevel } = options;

  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  let resolvedModel;
  if (model && provider) {
    resolvedModel = modelRegistry.find(provider, model);
  } else if (model) {
    const available = modelRegistry.getAvailable();
    resolvedModel = available.find((m) => m.id === model);
  }

  if (!resolvedModel) {
    const available = modelRegistry.getAvailable();
    if (available.length === 0) {
      throw new Error("No models available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or other provider keys.");
    }
    resolvedModel = available[0];
  }

  const isCoordinator = category === "coordinator";
  const reportTool = isCoordinator
    ? createSubmitReviewTool()
    : createReportFindingTool(category as ReviewCategory);

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    systemPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    model: resolvedModel,
    thinkingLevel: thinkingLevel as any,
    authStorage,
    modelRegistry,
    tools: ["read", "grep", "find", "ls"],
    customTools: [reportTool.tool],
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
  });

  return {
    session,
    getFindings: isCoordinator
      ? () => { throw new Error("Use getReview() for coordinator"); }
      : () => (reportTool as ReturnType<typeof createReportFindingTool>).findings(),
    getReview: isCoordinator
      ? () => (reportTool as ReturnType<typeof createSubmitReviewTool>).review()
      : () => { throw new Error("Use getFindings() for reviewers"); },
    model: resolvedModel,
  };
}

/** Run a session with a prompt, collecting output and usage stats. */
export async function runSession(
  session: Awaited<ReturnType<typeof createReviewerSession>>["session"],
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ output: string; usage: TokenUsage }> {
  const output: string[] = [];
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
  };

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      output.push(event.assistantMessageEvent.delta);
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const msgUsage = event.message.usage;
      if (msgUsage) {
        usage.inputTokens += msgUsage.input;
        usage.outputTokens += msgUsage.output;
        usage.cacheReadTokens += msgUsage.cacheRead;
        usage.cacheWriteTokens += msgUsage.cacheWrite;
        usage.cost += msgUsage.cost?.total ?? 0;
      }
    }
  });

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    await session.prompt(prompt, { source: "interactive" });
  } finally {
    clearTimeout(timeoutId);
    unsubscribe();
  }

  return { output: output.join(""), usage };
}
