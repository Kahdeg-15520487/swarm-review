/**
 * Output formatting — text, JSON, and markdown renderers.
 */
import type { ReviewResult } from "./types.js";
export declare function formatText(result: ReviewResult, useColor: boolean): string;
export declare function formatJson(result: ReviewResult): string;
export declare function formatMarkdown(result: ReviewResult): string;
export declare function formatOutput(result: ReviewResult, format: "text" | "json" | "markdown", useColor: boolean): string;
//# sourceMappingURL=output.d.ts.map