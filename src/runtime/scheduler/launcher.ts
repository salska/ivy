import { mkdirSync, appendFileSync } from 'node:fs';
import type { LaunchOptions, LaunchResult, SessionLauncher } from './types.ts';
import { normalizeToolUse, formatToolLog, buildLaunchArgs } from '../tool-adapter/index.ts';

/**
 * Resolve the log directory for dispatch agent logs.
 */
export function resolveLogDir(): string {
  if (process.env.IVY_LOG_DIR) return process.env.IVY_LOG_DIR;
  const home = process.env.HOME ?? '/tmp';
  return `${home}/.pai/blackboard/logs`;
}

/**
 * Get the log file path for a given session.
 */
export function logPathForSession(sessionId: string): string {
  return `${resolveLogDir()}/${sessionId}.log`;
}

/**
 * Retrieve the tail of the log file for the most recent crashed/abandoned agent
 * that was working on this item. Useful for prompt context recovery.
 */
export function getPreviousAgentLogs(db: import('bun:sqlite').Database, itemId: string, currentSessionId: string): string | null {
  try {
    const row = db.query(`
      SELECT actor_id as session_id
      FROM events
      WHERE event_type = 'work_claimed' AND target_id = ? AND actor_id != ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(itemId, currentSessionId) as { session_id: string } | null;

    if (!row) return null;

    const logPath = logPathForSession(row.session_id);
    const { existsSync, readFileSync } = require('node:fs');
    if (!existsSync(logPath)) return null;

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');
    
    // Grab the last 150 lines
    const tailLimit = 150;
    const tailLines = lines.length > tailLimit ? lines.slice(-tailLimit) : lines;
    
    const logs = tailLines.join('\n').trim();
    if (!logs) return null;
    return logs;
  } catch (err) {
    // Non-fatal, just optionally log 
    return null;
  }
}


/**
 * Summarize a tool_use content block into a concise log line.
 * Delegates to the tool adapter for provider-agnostic canonical formatting.
 */
function formatToolUse(block: any): string {
  const call = normalizeToolUse(block);
  if (call) return formatToolLog(call);

  // Fallback for unrecognized blocks
  const name = block?.name ?? 'unknown';
  return `[tool] ${name}`;
}

/**
 * Format a stream-json message into human-readable log lines.
 * Returns null for messages that shouldn't be logged.
 *
 * Stream-json message types:
 * - system: {subtype: "init"|"hook_started"|"hook_response", ...}
 * - assistant: {message: {content: [{type:"text",text:...}, {type:"tool_use",name:...,input:...}]}}
 * - tool_result: {content: [{type:"text",text:...}], is_error?: boolean}
 * - result: {subtype: "success"|"error", result?: string}
 */
function formatStreamMessage(msg: any): string | null {
  switch (msg.type) {
    case 'message': {
      // Handle top-level text messages (Gemini CLI)
      return msg.content ?? null;
    }
    case 'tool_use': {
      // Handle top-level tool calls (Gemini CLI)
      return formatToolUse(msg);
    }
    case 'assistant': {
      // Handle Claude-style nested content
      const content = msg.message?.content ?? [];
      const parts: string[] = [];

      for (const block of content) {
        if (block.type === 'text' && block.text) {
          parts.push(block.text);
        } else if (block.type === 'tool_use') {
          parts.push(formatToolUse(block));
        }
      }

      return parts.length > 0 ? parts.join('\n') : null;
    }
    case 'tool_result': {
      // Log errors with high priority. Log successes as [tool:ok] for monitoring.
      const isError = msg.is_error === true || msg.status === 'error';
      const text = Array.isArray(msg.content)
        ? msg.content.map((c: any) => c.text ?? '').join('')
        : String(msg.content ?? msg.output ?? msg.error?.message ?? msg.result ?? 'success');

      if (isError) {
        return `[tool:error] ${text.slice(0, 400)}`;
      }
      // For success, just show a tiny snippet or name if available
      return `[tool:ok] ${msg.tool_use_id ? `(${msg.tool_use_id}) ` : ''}${text.slice(0, 100)}`;
    }
    case 'result': {
      const text = msg.result ?? msg.content ?? '';
      if (!text) return null;
      return `\n--- RESULT ---\n${text}`;
    }
    case 'system': {
      // Skip hook lifecycle noise; only log init
      if (msg.subtype === 'init') return '[system] Session initialized';
      return null;
    }
    default:
      return null;
  }
}

/**
 * Stream stdout from `claude --print --output-format stream-json`,
 * parse each JSON message, and write human-readable lines to the log file.
 * Returns the full raw output for the LaunchResult.
 */
async function streamJsonToLog(
  stream: ReadableStream<Uint8Array>,
  logPath: string
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    chunks.push(text);
    buffer += text;

    // Process complete lines (each stream-json message is one line)
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // Keep incomplete last line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const formatted = formatStreamMessage(msg);
        if (formatted) {
          appendFileSync(logPath, formatted + '\n');
        }
      } catch {
        // Not valid JSON — write raw line
        if (line.trim().length > 0) {
          appendFileSync(logPath, line + '\n');
        }
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer);
      const formatted = formatStreamMessage(msg);
      if (formatted) appendFileSync(logPath, formatted + '\n');
    } catch {
      appendFileSync(logPath, buffer + '\n');
    }
  }

  return chunks.join('');
}

/**
 * Stream stderr lines to the log file with a prefix.
 */
async function streamStderrToLog(
  stream: ReadableStream<Uint8Array>,
  logPath: string
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    chunks.push(text);

    try {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.length > 0) {
          appendFileSync(logPath, `[stderr] ${line}\n`);
        }
      }
    } catch { }
  }

  return chunks.join('');
}

/**
 * Default launcher: spawns `claude --print --output-format stream-json`
 * in the project directory. Parses streaming JSON into human-readable
 * log lines written incrementally to a log file.
 */
async function defaultLauncher(opts: LaunchOptions): Promise<LaunchResult> {
  // Ensure log directory exists
  const logDir = resolveLogDir();
  mkdirSync(logDir, { recursive: true });

  const logPath = logPathForSession(opts.sessionId);
  const startTime = Date.now();

  // Write header to log file
  appendFileSync(logPath, [
    `=== Dispatch Session: ${opts.sessionId} ===`,
    `Work Dir: ${opts.workDir}`,
    `Started: ${new Date(startTime).toISOString()}`,
    `Timeout: ${opts.timeoutMs / 1000}s`,
    `---`,
    `Prompt: ${opts.prompt}`,
    `===`,
    '',
  ].join('\n'));

  // Build launch args via the tool adapter — no provider-specific branching here
  const args = buildLaunchArgs(opts.prompt, {
    disableMcp: opts.disableMcp,
  });

  const proc = Bun.spawn(args, {
    cwd: opts.workDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      // Fix for Node.js DNS resolution issues (ENOTFOUND) specifically when hitting
      // internal/Google APIs from node-based CLI tools (like the Gemini CLI)
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --dns-result-order=ipv4first`.trim()
    },
  });

  // Set up timeout
  const timeoutId = setTimeout(() => {
    appendFileSync(logPath, `\n=== TIMEOUT (${opts.timeoutMs / 1000}s) — sending SIGTERM ===\n`);
    proc.kill('SIGTERM');
  }, opts.timeoutMs);

  // Stream stdout (JSON) and stderr to log file in parallel
  const [stdout, stderr] = await Promise.all([
    streamJsonToLog(proc.stdout as ReadableStream<Uint8Array>, logPath),
    streamStderrToLog(proc.stderr as ReadableStream<Uint8Array>, logPath),
  ]);

  const exitCode = await proc.exited;
  clearTimeout(timeoutId);

  // Write footer
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  appendFileSync(logPath, `\n=== Exit Code: ${exitCode} | Duration: ${durationSec}s ===\n`);

  return { exitCode, stdout, stderr };
}

let currentLauncher: SessionLauncher = defaultLauncher;

/**
 * Get the current session launcher.
 */
export function getLauncher(): SessionLauncher {
  return currentLauncher;
}

/**
 * Override the session launcher (for testing).
 */
export function setLauncher(launcher: SessionLauncher): void {
  currentLauncher = launcher;
}

/**
 * Reset to the default launcher.
 */
export function resetLauncher(): void {
  currentLauncher = defaultLauncher;
}

/**
 * Check if a session log contains evidence of tool usage.
 * Returns false if the agent never invoked a single tool — a strong signal
 * that it did no meaningful work (e.g. just output a generic "how can I help" message).
 */
export function hasToolUsage(sessionId: string): boolean {
  try {
    const { readFileSync } = require('node:fs');
    const logPath = logPathForSession(sessionId);
    const content = readFileSync(logPath, 'utf-8');
    
    // Check for multiple indicators of life:
    // 1. [tool] - our canonical prefix from formatStreamMessage
    // 2. </tool> or </tools> - common XML markers used by internal Gemini CLI tools
    // 3. PHASE_REPORT: or HANDOVER_CONTEXT: - structured agent reports
    const patterns = [
      /\[tool\]/i,
      /<\/tool>/i,
      /<\/tools>/i,
      /PHASE_REPORT:/i,
      /HANDOVER_CONTEXT:/i
    ];

    if (!patterns.some(p => p.test(content))) return false;

    // Additional check: did they actually DO something?
    // If they only did 'ls', 'Glob', or 'Read', and didn't provide a PHASE_REPORT/HANDOVER,
    // they might have just been looking around.
    const hasWrite = /\[tool\] (Write|Edit|TodoWrite|Bash|RunCommand|supertag create|supertag edit|supertag set-field|supertag tag)/i.test(content);
    const hasStructuredReport = /PHASE_REPORT:|HANDOVER_CONTEXT:/i.test(content);

    // We allow completion if they either wrote something OR provided a structured report.
    // Reading-only is not enough to mark a "monitoring" or "build" task as completed.
    return hasWrite || hasStructuredReport;
  } catch {
    // If log doesn't exist or can't be read, assume tools were used (fail open)
    return true;
  }
}
