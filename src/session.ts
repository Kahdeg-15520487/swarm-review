import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool, AgentEvent } from "@earendil-works/pi-agent-core";
import { getModel, streamSimpleOpenAICompletions } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Finding, Severity, ReviewCategory, TokenUsage } from "./types.js";

// ── Tool: report_finding ──

function createReportFindingTool(category: ReviewCategory) {
  const findings: Finding[] = [];

  const tool: AgentTool<typeof reportFindingSchema, { recorded: number }> = {
    name: "report_finding",
    label: "Report Finding",
    description: "Report a code review finding. Call this for each issue you discover.",
    parameters: reportFindingSchema,
    async execute(_id, params) {
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
        details: { recorded: findings.length },
      };
    },
  };

  return { tool, findings: () => [...findings] };
}

const reportFindingSchema = Type.Object({
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
});

// ── Tool: submit_review ──

export interface CoordinatorReview {
  verdict: "approved" | "approved_with_comments" | "minor_issues" | "significant_concerns";
  findings: Finding[];
  summary: string;
}

function createSubmitReviewTool() {
  let review: CoordinatorReview | null = null;

  const tool: AgentTool<typeof submitReviewSchema, { submitted: boolean }> = {
    name: "submit_review",
    label: "Submit Review",
    description: "Submit the final consolidated review. Call this ONCE after analyzing all reviewer findings.",
    parameters: submitReviewSchema,
    async execute(_id, params) {
      review = {
        verdict: params.verdict as CoordinatorReview["verdict"],
        findings: params.findings as Finding[],
        summary: params.summary,
      };
      return {
        content: [{ type: "text" as const, text: `Review submitted: ${params.verdict}` }],
        details: { submitted: true },
        terminate: true,
      };
    },
  };

  return { tool, review: () => review };
}

const submitReviewSchema = Type.Object({
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
});

// ── Session options ──

export interface SessionOptions {
  systemPrompt: string;
  category: ReviewCategory | "coordinator";
  model: string;
  provider: string;
  getApiKey: (provider: string) => string | undefined;
  thinkingLevel?: string;
}

// ── Create reviewer session ──

export async function createReviewerSession(options: SessionOptions) {
  const { systemPrompt, category, model: modelId, provider, getApiKey, thinkingLevel } = options;

  const model = getModel(provider as any, modelId as any);
  if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);

  const isCoordinator = category === "coordinator";
  const reportTool = isCoordinator
    ? createSubmitReviewTool()
    : createReportFindingTool(category as ReviewCategory);

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: (thinkingLevel as any) ?? "off",
      tools: [reportTool.tool],
    },
    streamFn: streamSimpleOpenAICompletions as any,
    getApiKey,
  });

  return {
    agent,
    getFindings: isCoordinator
      ? () => { throw new Error("Use getReview() for coordinator"); }
      : () => (reportTool as ReturnType<typeof createReportFindingTool>).findings(),
    getReview: isCoordinator
      ? () => (reportTool as ReturnType<typeof createSubmitReviewTool>).review()
      : () => { throw new Error("Use getFindings() for reviewers"); },
    model,
  };
}

// ── Run session ──

export async function runSession(
  agent: Agent,
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
  onEvent?: (source: string, event: AgentEvent) => void,
  /** Label used as the source in onEvent callbacks. Defaults to "reviewer". */
  eventSource?: string,
): Promise<{ output: string; usage: TokenUsage; events: AgentEvent[] }> {
  const output: string[] = [];
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
  };
  const events: AgentEvent[] = [];

  const unsubscribe = agent.subscribe((event) => {
    events.push(event);
    onEvent?.(eventSource ?? "reviewer", event);

    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      output.push(event.assistantMessageEvent.delta);
    }
    if (event.type === "turn_end") {
      const msg = event.message;
      if (msg.role === "assistant" && "usage" in msg) {
        const u = (msg as any).usage;
        if (u) {
          usage.inputTokens += u.input ?? 0;
          usage.outputTokens += u.output ?? 0;
          usage.cacheReadTokens += u.cacheRead ?? 0;
          usage.cacheWriteTokens += u.cacheWrite ?? 0;
          usage.cost += u.cost?.total ?? 0;
        }
      }
    }
  });

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    await agent.prompt(prompt);
    await agent.waitForIdle();
  } finally {
    clearTimeout(timeoutId);
    unsubscribe();
  }

  return { output: output.join(""), usage, events };
}
