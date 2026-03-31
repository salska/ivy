import { existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";

/**
 * Resolves the database path based on:
 * 1. Explicit --db flag
 * 2. BLACKBOARD_DB environment variable
 * 3. Recursive upward walk for .blackboard/local.db
 * 4. Fallback to ~/.pai/blackboard/local.db
 */
export function resolveDbPath(explicitPath?: string): string {
  // 1. Explicit flag
  if (explicitPath) {
    return resolve(explicitPath);
  }

  // 2. Env var
  if (process.env.BLACKBOARD_DB) {
    return resolve(process.env.BLACKBOARD_DB);
  }

  // 3. Upward walk
  let currentDir = process.cwd();
  while (currentDir !== dirname(currentDir)) {
    const candidate = join(currentDir, ".blackboard", "local.db");
    if (existsSync(candidate)) {
      return candidate;
    }
    currentDir = dirname(currentDir);
  }

  // 4. Global fallback
  const fallback = join(homedir(), ".pai", "blackboard", "local.db");
  return fallback;
}
