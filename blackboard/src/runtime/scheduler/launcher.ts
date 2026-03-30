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
  logPath: string,
  signal?: AbortSignal
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let buffer = '';

  const cancelReader = () => { reader.cancel().catch(() => {}) };
  signal?.addEventListener('abort', cancelReader);

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {});
        break;
      }

      let done: boolean, value: Uint8Array | undefined;
      try {
        const result = await reader.read();
        done = result.done;
        value = result.value;
      } catch {
        break;
      }
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      chunks.push(text);
      buffer += text;

      // Process complete lines (each stream-json message is one line)
      let parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      
      for (const line of parts) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const formatted = formatStreamMessage(msg);
          if (formatted) appendFileSync(logPath, formatted + '\n');
        } catch {
          appendFileSync(logPath, line + '\n');
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
  } finally {
    signal?.removeEventListener('abort', cancelReader);
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
  let currentModel = opts.model;

  // Models to try in order when quota is exhausted
  const FALLBACK_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash-exp',
    'gemini-exp-1206',
  ];
  const triedModels = new Set<string | undefined>();

  while (true) {
    triedModels.add(currentModel);
    const startTime = Date.now();

    // Write header to log file
    appendFileSync(logPath, [
      `=== Dispatch Session: ${opts.sessionId} ===`,
      `Work Dir: ${opts.workDir}`,
      `Started: ${new Date(startTime).toISOString()}`,
      `Timeout: ${opts.timeoutMs / 1000}s`,
      currentModel ? `Model Override: ${currentModel}` : `Model Override: None (default)`,
      `---`,
      `Prompt: ${opts.prompt}`,
      `===`,
      '',
    ].join('\n'));

    // Build launch args via the tool adapter — no provider-specific branching here
    const args = buildLaunchArgs(opts.prompt, {
      disableMcp: opts.disableMcp,
      model: currentModel,
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

    const abortController = new AbortController();

    // Stream stderr with early-kill on quota exhaustion.
    // The Gemini CLI retries the same exhausted model 9+ times (~30s each)
    // before throwing TerminalQuotaError. We detect the first retry message
    // and kill the process immediately to avoid wasting ~5 minutes.
    let quotaDetected = false;
    const stderrPromise = (async () => {
      const reader = (proc.stderr as ReadableStream<Uint8Array> | null)?.getReader();
      if (!reader) return "";
      const decoder = new TextDecoder();
      const chunks: string[] = [];

      const cancelReader = () => { reader.cancel().catch(() => {}) };
      abortController.signal.addEventListener('abort', cancelReader);

      try {
        while (true) {
          if (abortController.signal.aborted) {
            reader.cancel().catch(() => {});
            break;
          }

          let done: boolean, value: Uint8Array | undefined;
          try {
            const result = await reader.read();
            done = result.done;
            value = result.value;
          } catch {
            break;
          }
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          chunks.push(text);

          // Early kill: detect quota exhaustion, model missing, or persistent server errors
          // to avoid waiting for the CLI to exhaust its internal retries.
          if (!quotaDetected && (
            text.includes('exhausted your capacity') || 
            text.includes('Attempt 1 failed') || 
            text.includes('ModelNotFoundError')
          )) {
            quotaDetected = true;
            const killMsg = `[system] 🔪 API error detected on model "${currentModel || 'default'}" — aborting current attempt`;
            appendFileSync(logPath, `\n${killMsg}\n`);
            proc.kill('SIGKILL'); // Use SIGKILL to prevent the CLI from catching it
            abortController.abort(); // Unblock both stderr and stdout immediately
            break; // Stop reading stderr
          }

          if (quotaDetected) {
          // Skip logging the rest of the noisy stack trace
          continue;
        }

        try {
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.trim().length > 0) {
              appendFileSync(logPath, `[stderr] ${line}\n`);
            }
          }
        } catch { }
      }
      } finally {
        abortController.signal.removeEventListener('abort', cancelReader);
      }

      return chunks.join('');
    })();

    // Stream stdout (JSON) to log file in parallel
    const [stdout, stderr] = await Promise.all([
      proc.stdout ? streamJsonToLog(proc.stdout as any, logPath, abortController.signal) : Promise.resolve(""),
      stderrPromise || Promise.resolve(""),
    ]);

    const exitCode = await proc.exited;
    clearTimeout(timeoutId);

    // Write footer
    const durationSec = Math.round((Date.now() - startTime) / 1000);
    appendFileSync(logPath, `\n=== Exit Code: ${exitCode} | Duration: ${durationSec}s ===\n`);

    // If we hit a quota error OR a model not found error, try to fall back
    const isModelNotFound = exitCode !== 0 && stderr.includes('ModelNotFoundError');
    const isRecoverableError = quotaDetected || (exitCode !== 0 && stderr.includes('TerminalQuotaError') && stderr.includes('exhausted your capacity')) || isModelNotFound;

    if (isRecoverableError) {
      if (process.stdout.isTTY) {
        console.log(`\n❌ Gemini API Error (${isModelNotFound ? 'ModelNotFoundError' : 'TerminalQuotaError'})`);
        const available = FALLBACK_MODELS.filter(m => !triedModels.has(m));
        if (available.length === 0) {
          console.log('⛔ All fallback models exhausted. Giving up.');
          break;
        }

        const answer = await new Promise<string>((resolve) => {
          const rl = require('node:readline').createInterface({
            input: process.stdin,
            output: process.stdout
          });
          rl.question(`\nSelect a model to retry [1-${available.length + 1}]:\n` +
            available.map((m, i) => `${i + 1}. ${m}`).join('\n') +
            `\n${available.length + 1}. Give up\n> `, (ans: string) => {
              rl.close();
              resolve(ans.trim());
            });
        });

        const choice = parseInt(answer, 10);
        if (choice > 0 && choice <= available.length) {
          currentModel = available[choice - 1];
          continue;
        } else {
          break;
        }
      } else {
        // Headless execution: cascade through fallback models
        const nextModel = FALLBACK_MODELS.find(m => !triedModels.has(m));
        if (nextModel) {
          currentModel = nextModel;
          const reason = isModelNotFound ? 'Model Not Found' : 'Quota Exhausted';
          const msg = `[system] ❌ ${reason} on ${[...triedModels].filter(Boolean).pop() || 'default model'}. 🔄 Auto-retrying with model: ${currentModel}...`;
          appendFileSync(logPath, `\n${msg}\n\n`);
          console.log(`[Dispatch Session ${opts.sessionId}] ${msg}`);
          continue;
        }
        
        appendFileSync(logPath, `\n[system] ⛔ All fallback models exhausted (tried: ${[...triedModels].filter(Boolean).join(', ')}). Giving up.\n\n`);
        break;
      }
    }

    return { exitCode, stdout, stderr };
  }

  return { exitCode: 1, stdout: '', stderr: 'All fallback models exhausted' };
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
 * Returns false if the agent never invoked a single tool.
 */
export function hasToolUsage(sessionId: string): boolean {
  try {
    const { readFileSync, existsSync } = require('node:fs');
    const logPath = logPathForSession(sessionId);
    if (!existsSync(logPath)) return true; // fail open if no log
    
    const content = readFileSync(logPath, 'utf-8');
    
    // Skip the prompt preamble — it contains instructions that match our patterns.
    // The preamble ends with === on its own line.
    const parts = content.split('\n===\n');
    if (parts.length < 2) return true; // Unusual format, fail open
    const agentOutput = parts.slice(1).join('\n===\n');

    // Check for multiple indicators of life:
    // 1. [tool] - our canonical prefix from formatStreamMessage
    // 2. </tool> or </tools> - common XML markers used by internal Gemini CLI tools
    // 3. PHASE_REPORT: or HANDOVER_CONTEXT: - structured agent reports
    // 4. --- RESULT --- - The final section emitted by the launcher
    const patterns = [
      /\[tool\]/i,
      /<\/tool>/i,
      /<\/tools>/i,
      /PHASE_REPORT:/i,
      /HANDOVER_CONTEXT:/i,
      /--- RESULT ---/i
    ];

    if (!patterns.some(p => p.test(agentOutput))) return false;

    // We allow completion if they either performed an action OR provided a structured report.
    // This allows pure research/planning phases to succeed.
    return (
      hasActionUsage(sessionId) || 
      /PHASE_REPORT:|HANDOVER_CONTEXT:/i.test(agentOutput)
    );
  } catch {
    return true; // fail open
  }
}

/**
 * Check if a session log contains evidence of ACTION tool usage.
 * Action tools are those that modify the filesystem or perform side-effects.
 */
export function hasActionUsage(sessionId: string): boolean {
  try {
    const { readFileSync, existsSync } = require('node:fs');
    const logPath = logPathForSession(sessionId);
    if (!existsSync(logPath)) return false;

    const content = readFileSync(logPath, 'utf-8');
    
    // Skip prompt preamble
    const parts = content.split('\n===\n');
    if (parts.length < 2) return false;
    const agentOutput = parts.slice(1).join('\n===\n');

    // Action tools must have been at least attempted.
    // We look for [tool] followed by an action tool name.
    // We expanded this to include Write, Edit, TodoWrite, and Bash, 
    // AND we now check for any tool that doesn't look like a read-only one.
    const actionPattern = /\[tool\] (Write|Edit|TodoWrite|Bash|RunCommand|supertag (create|edit|set-field|tag|done|undone|trash))/i;
    
    // Also consider any tool use that isn't Glob, Read, Search, ls, or Help as a potential "action"
    const genericToolPattern = /\[tool\] (?!(Glob|Read|Search|ls|Help|TanaSearch|nodes show|tags list|tags show|query))/i;

    return actionPattern.test(agentOutput) || genericToolPattern.test(agentOutput);
  } catch {
    return false;
  }
}
