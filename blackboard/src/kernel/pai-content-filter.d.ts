/**
 * Ambient type declarations for the pai-content-filter module.
 * This package is loaded at runtime but may not ship its own .d.ts files.
 */
declare module "pai-content-filter" {
    export interface FilterMatch {
        pattern_id: string;
        pattern_name: string;
        category: string;
        severity: string;
        matched_text?: string;
    }

    export interface FilterResult {
        decision: "ALLOWED" | "BLOCKED" | "HUMAN_REVIEW";
        matches: FilterMatch[];
    }

    export type FileFormat = "text" | "markdown" | "code" | "json" | "yaml" | "html" | "mixed";

    export function filterContentString(
        content: string,
        label: string,
        contentType?: FileFormat
    ): FilterResult;
}
