/**
 * Decomposer Module
 * Breaks app specifications into independent features
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import type { DecomposedFeature } from "../types";

// =============================================================================
// Prompt Loading
// =============================================================================

const PROMPTS_DIR = join(import.meta.dir, "../../prompts");

/**
 * Load the decomposition prompt template
 */
export function loadDecomposePrompt(): string {
  const promptPath = join(PROMPTS_DIR, "decompose.md");
  return readFileSync(promptPath, "utf-8");
}

/**
 * Build the full prompt with app spec injected
 */
export function buildDecomposePrompt(appSpec: string): string {
  const template = loadDecomposePrompt();
  return template.replace("{{APP_SPEC}}", appSpec);
}

// =============================================================================
// Output Parsing
// =============================================================================

/**
 * Parse the decomposition output from Claude
 * Extracts JSON array of features from markdown/text response
 */
export function parseDecompositionOutput(output: string): DecomposedFeature[] {
  // Clean up potential noise before/after the JSON
  let cleaned = output.trim();
  
  // Try to extract JSON from code fence (supports ```json or ```)
  const codeFenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  let jsonStr: string;

  if (codeFenceMatch) {
    jsonStr = codeFenceMatch[1].trim();
  } else {
    // Try to find the first '[' and last ']' to extract the array
    const startIdx = cleaned.indexOf('[');
    const endIdx = cleaned.lastIndexOf(']');
    
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      jsonStr = cleaned.substring(startIdx, endIdx + 1);
    } else {
      throw new Error(`Could not find JSON array in output: ${cleaned.slice(0, 100)}...`);
    }
  }

  // Final sanitization: Remove any stray backticks that might have been captured
  jsonStr = jsonStr.replace(/\\`/g, "`").replace(/`/g, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    // One more attempt: try to fix common trailing commas or single quotes
    try {
       const relaxedJson = jsonStr.replace(/,\s*\]/g, "]").replace(/,\s*\}/g, "}");
       parsed = JSON.parse(relaxedJson);
    } catch {
       throw new Error(`Failed to parse JSON: ${e} | Raw substring: ${jsonStr.slice(0, 200)}`);
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected array of features");
  }

  // Validate and cast each feature
  return parsed.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Feature at index ${index} is not an object`);
    }

    const obj = item as Record<string, unknown>;

    // Build base feature
    const feature: DecomposedFeature = {
      id: String(obj.id ?? `F-${index + 1}`),
      name: String(obj.name ?? ""),
      description: String(obj.description ?? ""),
      dependencies: Array.isArray(obj.dependencies)
        ? obj.dependencies.map(String)
        : [],
      priority: typeof obj.priority === "number" ? obj.priority : index + 1,
    };

    // Parse rich decomposition fields (required for batch mode)
    if (isValidProblemType(obj.problemType)) {
      feature.problemType = obj.problemType;
    }
    if (isValidUrgencyType(obj.urgency)) {
      feature.urgency = obj.urgency;
    }
    if (isValidPrimaryUserType(obj.primaryUser)) {
      feature.primaryUser = obj.primaryUser;
    }
    if (isValidIntegrationScopeType(obj.integrationScope)) {
      feature.integrationScope = obj.integrationScope;
    }

    // Parse optional rich fields
    if (isValidUsageContextType(obj.usageContext)) {
      feature.usageContext = obj.usageContext;
    }
    if (isValidDataRequirementsType(obj.dataRequirements)) {
      feature.dataRequirements = obj.dataRequirements;
    }
    if (isValidPerformanceRequirementsType(obj.performanceRequirements)) {
      feature.performanceRequirements = obj.performanceRequirements;
    }
    if (isValidPriorityTradeoffType(obj.priorityTradeoff)) {
      feature.priorityTradeoff = obj.priorityTradeoff;
    }

    // Parse uncertainty handling
    if (Array.isArray(obj.uncertainties)) {
      feature.uncertainties = obj.uncertainties.map(String);
    }
    if (typeof obj.clarificationNeeded === "string") {
      feature.clarificationNeeded = obj.clarificationNeeded;
    }

    return feature;
  });
}

// =============================================================================
// Type Validators
// =============================================================================

const VALID_PROBLEM_TYPES = ["manual_workaround", "impossible", "scattered", "quality_issues"] as const;
const VALID_URGENCY_TYPES = ["external_deadline", "growing_pain", "blocking_work", "user_demand"] as const;
const VALID_PRIMARY_USER_TYPES = ["developers", "end_users", "admins", "mixed"] as const;
const VALID_INTEGRATION_SCOPE_TYPES = ["standalone", "extends_existing", "multiple_integrations", "external_apis"] as const;
const VALID_USAGE_CONTEXT_TYPES = ["daily", "occasional", "one_time", "emergency"] as const;
const VALID_DATA_REQUIREMENTS_TYPES = ["existing_only", "new_model", "external_data", "user_generated"] as const;
const VALID_PERFORMANCE_REQUIREMENTS_TYPES = ["realtime", "interactive", "background", "none"] as const;
const VALID_PRIORITY_TRADEOFF_TYPES = ["speed", "quality", "completeness", "ux"] as const;

function isValidProblemType(value: unknown): value is typeof VALID_PROBLEM_TYPES[number] {
  return typeof value === "string" && VALID_PROBLEM_TYPES.includes(value as typeof VALID_PROBLEM_TYPES[number]);
}

function isValidUrgencyType(value: unknown): value is typeof VALID_URGENCY_TYPES[number] {
  return typeof value === "string" && VALID_URGENCY_TYPES.includes(value as typeof VALID_URGENCY_TYPES[number]);
}

function isValidPrimaryUserType(value: unknown): value is typeof VALID_PRIMARY_USER_TYPES[number] {
  return typeof value === "string" && VALID_PRIMARY_USER_TYPES.includes(value as typeof VALID_PRIMARY_USER_TYPES[number]);
}

function isValidIntegrationScopeType(value: unknown): value is typeof VALID_INTEGRATION_SCOPE_TYPES[number] {
  return typeof value === "string" && VALID_INTEGRATION_SCOPE_TYPES.includes(value as typeof VALID_INTEGRATION_SCOPE_TYPES[number]);
}

function isValidUsageContextType(value: unknown): value is typeof VALID_USAGE_CONTEXT_TYPES[number] {
  return typeof value === "string" && VALID_USAGE_CONTEXT_TYPES.includes(value as typeof VALID_USAGE_CONTEXT_TYPES[number]);
}

function isValidDataRequirementsType(value: unknown): value is typeof VALID_DATA_REQUIREMENTS_TYPES[number] {
  return typeof value === "string" && VALID_DATA_REQUIREMENTS_TYPES.includes(value as typeof VALID_DATA_REQUIREMENTS_TYPES[number]);
}

function isValidPerformanceRequirementsType(value: unknown): value is typeof VALID_PERFORMANCE_REQUIREMENTS_TYPES[number] {
  return typeof value === "string" && VALID_PERFORMANCE_REQUIREMENTS_TYPES.includes(value as typeof VALID_PERFORMANCE_REQUIREMENTS_TYPES[number]);
}

function isValidPriorityTradeoffType(value: unknown): value is typeof VALID_PRIORITY_TRADEOFF_TYPES[number] {
  return typeof value === "string" && VALID_PRIORITY_TRADEOFF_TYPES.includes(value as typeof VALID_PRIORITY_TRADEOFF_TYPES[number]);
}

// =============================================================================
// Validation
// =============================================================================

// Minimum feature count - projects simpler than this don't need SpecFlow
export const MIN_FEATURES_HARD_FLOOR = 3;
export const DEFAULT_MIN_FEATURES = 5;
export const DEFAULT_MAX_FEATURES = 15;

/**
 * Validate decomposed features for completeness and consistency
 * Returns array of error messages (empty if valid)
 */
export function validateDecomposedFeatures(
  features: DecomposedFeature[],
  options: { minFeatures?: number; maxFeatures?: number } = {}
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  const minFeatures = options.minFeatures ?? DEFAULT_MIN_FEATURES;
  const maxFeatures = options.maxFeatures ?? DEFAULT_MAX_FEATURES;

  // Enforce minimum feature count
  if (features.length < MIN_FEATURES_HARD_FLOOR) {
    errors.push(
      `Too few features: ${features.length} (minimum ${MIN_FEATURES_HARD_FLOOR}). ` +
        `If your project is simpler than ${MIN_FEATURES_HARD_FLOOR} features, you don't need SpecFlow.`
    );
  } else if (features.length < minFeatures) {
    errors.push(
      `Feature count ${features.length} is below recommended minimum of ${minFeatures}. ` +
        `Consider breaking features into smaller, independently testable units.`
    );
  }

  // Warn if too many features
  if (features.length > maxFeatures) {
    errors.push(
      `Too many features: ${features.length} (maximum ${maxFeatures}). ` +
        `Consider grouping related features or splitting into multiple projects.`
    );
  }

  for (const feature of features) {
    // Check required fields
    if (!feature.id || feature.id.trim() === "") {
      errors.push(`Feature missing id`);
    }
    if (!feature.name || feature.name.trim() === "") {
      errors.push(`Feature ${feature.id}: missing name`);
    }
    if (!feature.description || feature.description.trim() === "") {
      errors.push(`Feature ${feature.id}: missing description`);
    }

    // Check for duplicate IDs
    if (ids.has(feature.id)) {
      errors.push(`Duplicate feature ID: ${feature.id}`);
    }
    ids.add(feature.id);
  }

  // Validate dependencies reference existing features
  for (const feature of features) {
    for (const dep of feature.dependencies) {
      if (!ids.has(dep)) {
        errors.push(`Feature ${feature.id}: dependency ${dep} not found`);
      }
    }
  }

  return errors;
}

// =============================================================================
// Priority Assignment
// =============================================================================

/**
 * Assign priorities based on dependency graph
 * Features with no dependencies get priority 1
 * Dependent features get max(dependency priorities) + 1
 */
export function assignPriorities(features: DecomposedFeature[]): DecomposedFeature[] {
  const priorityMap = new Map<string, number>();
  const featureMap = new Map<string, DecomposedFeature>();

  // Index features by ID
  for (const feature of features) {
    featureMap.set(feature.id, feature);
  }

  // Recursive function to calculate priority
  function calculatePriority(id: string, visited: Set<string>): number {
    if (priorityMap.has(id)) {
      return priorityMap.get(id)!;
    }

    if (visited.has(id)) {
      // Circular dependency, return current depth
      return visited.size;
    }

    const feature = featureMap.get(id);
    if (!feature) {
      return 1;
    }

    visited.add(id);

    if (feature.dependencies.length === 0) {
      priorityMap.set(id, 1);
      return 1;
    }

    // Priority is max of dependency priorities + 1
    let maxDepPriority = 0;
    for (const depId of feature.dependencies) {
      const depPriority = calculatePriority(depId, visited);
      maxDepPriority = Math.max(maxDepPriority, depPriority);
    }

    const priority = maxDepPriority + 1;
    priorityMap.set(id, priority);
    return priority;
  }

  // Calculate priorities for all features
  for (const feature of features) {
    calculatePriority(feature.id, new Set());
  }

  // Return features with assigned priorities
  return features.map((feature) => ({
    ...feature,
    priority: priorityMap.get(feature.id) ?? 1,
  }));
}

// =============================================================================
// Decomposition Execution
// =============================================================================

// =============================================================================
// LLM Invocation
// =============================================================================

/**
 * Execute an LLM command and parse the result.
 * Correcty handles 'stream-json' format from Gemini CLI.
 */
export function callLLM(prompt: string): string {
  const llmCmd = process.env.SPECFLOW_LLM_COMMAND || process.env.HEARTBEAT_AGENT_COMMAND || "claude";
  const llmArgs = llmCmd === "claude" 
    ? ["--print", "--dangerously-skip-permissions", prompt]
    : ["--output-format", "stream-json", prompt];

  const result = spawnSync(llmCmd, llmArgs, {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env },
  });

  if (result.status !== 0) {
    throw new Error(`${llmCmd} command failed: ${result.status === null ? 'Killed/Signal' : result.stderr || 'Status ' + result.status}`);
  }

  const stdout = result.stdout;
  if (llmCmd === "claude") {
    return stdout;
  }

  // Handle stream-json (Gemini)
  const lines = stdout.split("\n");
  let fullText = "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            fullText += block.text;
          }
        }
      } else if (msg.type === "result" && msg.result) {
         // Some versions might put final result here
         if (!fullText) fullText = msg.result;
      }
    } catch (e) {
      // Not JSON line, might be raw text from LLM or error
      if (!line.startsWith("{")) {
         fullText += line + "\n";
      }
    }
  }

  return fullText || stdout;
}

export interface DecomposeOptions {
  minFeatures?: number;
  maxFeatures?: number;
}

/**
 * Decompose an app description into features using Claude (batch mode)
 * Unlike decomposeSpec, this takes a raw description string instead of a file path
 */
export async function decomposeDescription(
  description: string,
  options: DecomposeOptions = {}
): Promise<DecomposedFeature[]> {
  const { minFeatures = 5, maxFeatures = 20 } = options;

  const prompt = `You are decomposing an application into implementable features for a spec-driven development workflow.

## Application Description

${description}

## Instructions

Decompose this application into ${minFeatures}-${maxFeatures} independent, implementable features.

Each feature should be:
- Completable in 1-4 hours of focused work
- Independently testable
- A user-visible capability, not an internal module

Output a JSON array (no markdown, no code fences, just raw JSON) with this structure:
[
  {
    "id": "F-1",
    "name": "Feature name",
    "description": "What it does in 1-2 sentences",
    "dependencies": [],
    "priority": 1,
    "problemType": "manual_workaround|impossible|scattered|quality_issues",
    "urgency": "external_deadline|growing_pain|blocking_work|user_demand",
    "primaryUser": "developers|end_users|admins|mixed",
    "integrationScope": "standalone|extends_existing|multiple_integrations|external_apis"
  }
]

Rules:
- Order features by implementation dependency
- Earlier features should NOT depend on later ones
- Include rich decomposition fields (problemType, urgency, primaryUser, integrationScope) for each feature
- Output ONLY the JSON array, nothing else`;

  const stdout = callLLM(prompt);
  const features = parseDecompositionOutput(stdout);

  const errors = validateDecomposedFeatures(features, { minFeatures, maxFeatures });
  if (errors.length > 0) {
    throw new Error(`Decomposition validation failed:\n${errors.join("\n")}`);
  }

  return assignPriorities(features);
}

/**
 * Decompose an app specification into features using Claude
 */
export async function decomposeSpec(
  appSpecPath: string,
  options: DecomposeOptions = {}
): Promise<DecomposedFeature[]> {
  const { minFeatures = 5, maxFeatures = 20 } = options;

  // Read the app spec
  const appSpec = readFileSync(appSpecPath, "utf-8");

  // Build the prompt
  let prompt = buildDecomposePrompt(appSpec);
  prompt += `\n\nGenerate between ${minFeatures} and ${maxFeatures} features.`;

  // Call LLM via subprocess
  const stdout = callLLM(prompt);

  // Parse the output
  const features = parseDecompositionOutput(stdout);

  // Validate
  const errors = validateDecomposedFeatures(features);
  if (errors.length > 0) {
    throw new Error(`Decomposition validation failed:\n${errors.join("\n")}`);
  }

  // Assign priorities based on dependencies
  return assignPriorities(features);
}
