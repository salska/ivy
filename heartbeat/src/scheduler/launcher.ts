import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import type { Database } from 'bun:sqlite';
import type { LaunchOptions, LaunchResult, SessionLauncher } from './types.ts';

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
export function getPreviousAgentLogs(db: Database, itemId: string, currentSessionId: string): string | null {
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
    if (!existsSync(logPath)) return null;

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');
    const tailLimit = 150;
    const tailLines = lines.length > tailLimit ? lines.slice(-tailLimit) : lines;
    
    const logs = tailLines.join('\n').trim();
    return logs || null;
  } catch {
    return null;
  }
}

/**
 * Check if a session log contains evidence of tool usage.
 */
export function hasToolUsage(sessionId: string): boolean {
  try {
    const logPath = logPathForSession(sessionId);
    if (!existsSync(logPath)) return true; // fail open
    
    const content = readFileSync(logPath, 'utf-8');
    const parts = content.split('\n===\n');
    if (parts.length < 2) return true;
    const agentOutput = parts.slice(1).join('\n===\n');

    const patterns = [
      /\[tool\]/i,
      /<\/tool>/i,
      /PHASE_REPORT:/i,
      /HANDOVER_CONTEXT:/i,
      /--- RESULT ---/i
    ];

    if (!patterns.some(p => p.test(agentOutput))) return false;

    return (
      hasActionUsage(sessionId) || 
      /PHASE_REPORT:|HANDOVER_CONTEXT:/i.test(agentOutput)
    );
  } catch {
    return true;
  }
}

/**
 * Check if a session log contains evidence of ACTION tool usage.
 */
export function hasActionUsage(sessionId: string): boolean {
  try {
    const logPath = logPathForSession(sessionId);
    if (!existsSync(logPath)) return false;

    const content = readFileSync(logPath, 'utf-8');
    const parts = content.split('\n===\n');
    if (parts.length < 2) return false;
    const agentOutput = parts.slice(1).join('\n===\n');

    const actionPattern = /\[tool\] (Write|Edit|TodoWrite|Bash|RunCommand|supertag (create|edit|set-field|tag|done|undone|trash))/i;
    const genericToolPattern = /\[tool\] (?!(Glob|Read|Search|ls|Help|TanaSearch|nodes show|tags list|tags show|query))/i;

    return actionPattern.test(agentOutput) || genericToolPattern.test(agentOutput);
  } catch {
    return false;
  }
}

/**
 * Summarize a tool_use content block into a concise log line.
 */
function formatToolUse(block: any): string {
  const name = block.name ?? 'unknown';
  const input = block.input ?? {};
  switch (name) {
    case 'Bash': return `[tool] Bash: ${(input.command ?? '').slice(0, 200)}`;
    case 'Read': return `[tool] Read: ${input.file_path ?? ''}`;
    case 'Write': return `[tool] Write: ${input.file_path ?? ''}`;
    case 'Edit': return `[tool] Edit: ${input.file_path ?? ''}`;
    case 'Glob': return `[tool] Glob: ${input.pattern ?? ''}`;
    case 'Grep': return `[tool] Grep: ${input.pattern ?? ''}`;
    case 'Task': return `[tool] Task: ${input.description ?? ''}`;
    case 'TaskCreate': return `[tool] TaskCreate: ${input.subject ?? ''}`;
    case 'TaskUpdate': {
      const status = input.status ? ` → ${input.status}` : '';
      return `[tool] TaskUpdate: #${input.taskId ?? '?'}${status}`;
    }
    case 'TaskList': return '[tool] TaskList';
    case 'TaskOutput': return `[tool] TaskOutput: task=${input.task_id ?? '?'}`;
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      const summary = todos.map((t: any) => `${t.status === 'completed' ? '✓' : '○'} ${(t.content ?? '').slice(0, 60)}`).join(', ');
      return `[tool] TodoWrite: ${summary || '(empty)'}`;
    }
    case 'WebFetch': return `[tool] WebFetch: ${input.url ?? ''}`;
    case 'WebSearch': return `[tool] WebSearch: ${input.query ?? ''}`;
    case 'Skill': return `[tool] Skill: ${input.skill ?? ''}`;
    case 'NotebookEdit': return `[tool] NotebookEdit: ${input.notebook_path ?? ''}`;
    default: return `[tool] ${name}`;
  }
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
    case 'assistant': {
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
      // Log errors; skip successful results (too verbose)
      if (msg.is_error) {
        const text = Array.isArray(msg.content)
          ? msg.content.map((c: any) => c.text ?? '').join('')
          : String(msg.content ?? 'unknown error');
        return `[tool:error] ${text.slice(0, 300)}`;
      }
      return null;
    }
    case 'result': {
      const text = msg.result ?? '';
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

  const agentCmd = process.env.HEARTBEAT_AGENT_COMMAND ?? 'gemini';
  const args = [agentCmd];

  if (agentCmd === 'antigravity') {
    // Antigravity chat command supports an agent mode and reuse-window to avoid popups
    args.push('chat', '--mode', 'agent', '--reuse-window');
  } else if (agentCmd === 'claude') {
    args.push('--print', '--verbose', '--output-format', 'stream-json');
    if (opts.disableMcp) {
      args.push('--strict-mcp-config');
    }
  } else if (agentCmd === 'gemini') {
    // Use the gemini CLI as the autonomous worker
    args.push('--output-format', 'stream-json');
  }

  args.push(opts.prompt);

  const proc = Bun.spawn(args, {
    cwd: opts.workDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });

  // Set up timeout
  const timeoutId = setTimeout(() => {
    appendFileSync(logPath, `\n=== TIMEOUT (${opts.timeoutMs / 1000}s) — sending SIGTERM ===\n`);
    proc.kill('SIGTERM');
  }, opts.timeoutMs);

  // Stream stdout (JSON) and stderr to log file in parallel
  const [stdout, stderr] = await Promise.all([
    proc.stdout ? streamJsonToLog(proc.stdout as any, logPath) : Promise.resolve(""),
    proc.stderr ? streamStderrToLog(proc.stderr as any, logPath) : Promise.resolve(""),
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
