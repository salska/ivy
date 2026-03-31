/**
 * Headless LLM Runner
 * Shared utility for running an AI CLI in non-interactive (headless/CI) mode.
 * Supports `claude -p --output-format json` and `gemini -p --output-format json`.
 * The active CLI is resolved from SPECFLOW_LLM_COMMAND > HEARTBEAT_AGENT_COMMAND > "claude".
 *
 * In headless mode the CLI processes a prompt and returns text output.
 * It cannot execute tools or write files to disk. Commands that need file
 * artifacts (spec.md, plan.md) must extract content from the output and
 * write it themselves.
 *
 * Reference: doctorow.ts evaluateCheckWithAI() for the proven pattern.
 */

import { writeFileSync } from "fs";
import { extractJsonFromResponse } from "./doctorow";

// =============================================================================
// Types
// =============================================================================

export interface HeadlessResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface HeadlessOptions {
  /** Model override (default: SPECFLOW_MODEL env or claude-opus-4-5-20251101) */
  model?: string;
  /** Timeout in milliseconds (default: 120000) */
  timeout?: number;
  /** System prompt to prepend */
  systemPrompt?: string;
  /** Working directory for the spawned process */
  cwd?: string;
}

// =============================================================================
// Constants
// =============================================================================

const CLAUDE_DEFAULT_MODEL = "claude-opus-4-5-20251101";
const GEMINI_DEFAULT_MODEL = "gemini-2.5-pro";
const ANTIGRAVITY_DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_TIMEOUT = 120_000;

// =============================================================================
// Agent resolution
// =============================================================================

/** Resolve the CLI binary name from the environment. */
export function resolveAgentCommand(): string {
  return (
    process.env.SPECFLOW_LLM_COMMAND ||
    process.env.HEARTBEAT_AGENT_COMMAND ||
    "claude"
  );
}

/** Return true when the resolved agent is gemini CLI. */
function isGeminiAgent(cmd: string): boolean {
  return cmd === "gemini";
}

/** Return true when the resolved agent is antigravity (calls Gemini REST API directly). */
function isAntigravityAgent(cmd: string): boolean {
  return cmd === "antigravity";
}

/** Build CLI args for headless prompt execution (no TTY). */
function buildHeadlessArgs(cmd: string, model: string, systemPrompt?: string): string[] {
  if (isGeminiAgent(cmd)) {
    const args: string[] = ["-p", "--output-format", "json"];
    if (model && model !== GEMINI_DEFAULT_MODEL) {
      args.push("--model", model);
    }
    return args;
  }
  // claude
  const args: string[] = ["-p", "--output-format", "json", "--model", model];
  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }
  return args;
}

/**
 * Call the Gemini REST API directly using GEMINI_API_KEY.
 * Used when agentCmd === 'antigravity' to bypass CLI OAuth quota.
 */
async function runGeminiApiDirect(
  prompt: string,
  options: HeadlessOptions
): Promise<HeadlessResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, output: "", error: "GEMINI_API_KEY not set — cannot run antigravity headless" };
  }

  const model = options.model || process.env.SPECFLOW_MODEL || ANTIGRAVITY_DEFAULT_MODEL;
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  const fullPrompt = options.systemPrompt
    ? `${options.systemPrompt}\n\n${prompt}`
    : prompt;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
      }),
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, output: "", error: `Gemini API error ${resp.status}: ${err.slice(0, 300)}` };
    }

    const data = await resp.json() as any;
    const output: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!output) {
      return { success: false, output: "", error: "Gemini API returned empty response" };
    }

    const hasCompletion = output.includes("[PHASE COMPLETE") || output.includes("[FEATURE COMPLETE");
    return { success: true, output };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      return { success: false, output: "", error: `Gemini API timed out after ${timeout / 1000}s` };
    }
    return { success: false, output: "", error: String(err) };
  }
}

// =============================================================================
// Detection
// =============================================================================

/**
 * Returns true if running in headless mode.
 * Headless when stdin is not a TTY or SPECFLOW_HEADLESS=true.
 */
export function isHeadlessMode(): boolean {
  return !process.stdin.isTTY || process.env.SPECFLOW_HEADLESS === "true";
}

// =============================================================================
// Runner
// =============================================================================

/**
 * Run the configured LLM CLI in headless mode using `-p --output-format json`.
 * Supports both `claude` and `gemini`. Extracts the result text from the JSON envelope.
 */
export async function runClaudeHeadless(
  prompt: string,
  options: HeadlessOptions = {}
): Promise<HeadlessResult> {
  const agentCmd = resolveAgentCommand();
  const isGemini = isGeminiAgent(agentCmd);
  const isAntigravity = isAntigravityAgent(agentCmd);
  const defaultModel = isAntigravity ? ANTIGRAVITY_DEFAULT_MODEL : isGemini ? GEMINI_DEFAULT_MODEL : CLAUDE_DEFAULT_MODEL;
  const model = options.model || process.env.SPECFLOW_MODEL || defaultModel;
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const cwd = options.cwd || process.cwd();

  // ─── Prompt-output mode ──────────────────────────────────────────
  const promptOutputPath = process.env.SPECFLOW_PROMPT_OUTPUT;
  if (promptOutputPath) {
    const promptData = JSON.stringify({
      prompt,
      systemPrompt: options.systemPrompt ?? "",
      model,
      cwd,
    });
    writeFileSync(promptOutputPath, promptData);
    process.exit(0);
  }

  // ─── Antigravity: call Gemini REST API directly ───────────────────
  if (isAntigravity) {
    console.log(`[antigravity] Calling Gemini API directly (model: ${model})...`);
    return runGeminiApiDirect(prompt, { ...options, model });
  }

  // For gemini, prepend system prompt to the user prompt (no --system-prompt flag)
  const effectivePrompt = isGemini && options.systemPrompt
    ? `${options.systemPrompt}\n\n${prompt}`
    : prompt;

  const args = buildHeadlessArgs(agentCmd, model, options.systemPrompt);
  args.push(effectivePrompt);

  try {
    const proc = Bun.spawn([agentCmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd,
      env: { ...process.env, CLAUDECODE: undefined },
    });

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(null);
      }, timeout);
    });

    const resultPromise = (async () => {
      const rawOutput = await new Response(proc.stdout).text();
      const stderrOutput = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0 && !rawOutput) {
        return {
          success: false,
          output: "",
          error: stderrOutput || `Claude exited with code ${exitCode}`,
        };
      }

      // Extract text from JSON envelope
      let output = rawOutput;
      try {
        const parsed = JSON.parse(rawOutput);
        if (parsed.type === "result" && typeof parsed.result === "string") {
          output = parsed.result;
        }
      } catch {
        // Not JSON envelope, use raw output
      }

      // Check for phase completion markers
      const hasCompletion = output.includes("[PHASE COMPLETE") || output.includes("[FEATURE COMPLETE");
      const success = exitCode === 0 || hasCompletion;

      return { success, output };
    })();

    const result = await Promise.race([resultPromise, timeoutPromise]);

    if (!result) {
      return {
        success: false,
        output: "",
        error: `Claude timed out after ${timeout / 1000}s`,
      };
    }

    return result;
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Failed to spawn Claude: ${error}`,
    };
  }
}

// =============================================================================
// Output Extraction
// =============================================================================

/**
 * Extract a markdown artifact from Claude's headless output.
 *
 * In `claude -p` mode, Claude cannot write files — it returns text only.
 * This function extracts the spec/plan content from that text output so
 * the caller can write it to disk.
 *
 * Extraction strategy (in priority order):
 * 1. Look for a fenced markdown block (```markdown ... ```)
 * 2. Look for content starting with a markdown heading (# Specification: ...)
 * 3. Use the entire output as-is (stripping phase completion markers)
 */
export function extractMarkdownArtifact(output: string): string | null {
  if (!output || !output.trim()) {
    return null;
  }

  // Strategy 1: Extract from fenced markdown block
  const fencedMatch = output.match(/```(?:markdown|md)\s*\n([\s\S]*?)```/);
  if (fencedMatch && fencedMatch[1].trim()) {
    return fencedMatch[1].trim();
  }

  // Strategy 2: Extract from first markdown heading to phase marker (or end)
  const phaseMarkerIndex = output.search(/\n\[PHASE (?:COMPLETE|BLOCKED)/);
  const headingIndex = output.search(/^# /m);
  if (headingIndex !== -1) {
    const endIndex = phaseMarkerIndex !== -1 ? phaseMarkerIndex : output.length;
    const content = output.slice(headingIndex, endIndex).trim();
    if (content) {
      return content;
    }
  }

  // Strategy 3: Strip phase markers and use remaining content
  const stripped = output
    .replace(/\[PHASE (?:COMPLETE|BLOCKED)[^\]]*\][^\n]*/g, "")
    .replace(/Feature:.*$/gm, "")
    .replace(/Spec:.*$/gm, "")
    .replace(/Mode:.*$/gm, "")
    .replace(/Clarifications needed:.*$/gm, "")
    .trim();

  if (stripped.length > 50) {
    return stripped;
  }

  return null;
}
