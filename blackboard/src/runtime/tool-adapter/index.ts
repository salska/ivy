/**
 * Tool Adapter — Public API
 *
 * Auto-registers all built-in providers on import.
 */

// Re-export types
export type {
    CanonicalTool,
    ToolProvider,
    ToolCall,
    ProviderAdapter,
    LaunchAdapterOptions,
} from './types';
export { CANONICAL_TOOLS, TOOL_PROVIDERS } from './types';

// Re-export adapter factory
export {
    registerProvider,
    registeredProviders,
    resolveProvider,
    getAdapter,
    normalizeToolUse,
    formatToolLog,
    buildLaunchArgs,
    buildPromptPreamble,
} from './adapter';

// Re-export settings translator
export {
    translatePermissions,
    translateHookMatchers,
    translateSettings,
    normalizeSettings,
} from './settings-translator';
export type {
    PermissionsBlock,
    HookEntry,
    HooksBlock,
    TranslatableSettings,
} from './settings-translator';

// Re-export canonical log formatter
export { formatCanonicalLog } from './claude-provider';

// ---------------------------------------------------------------------------
// Auto-register built-in providers
// ---------------------------------------------------------------------------

import { registerProvider } from './adapter';
import { claudeProvider } from './claude-provider';
import { geminiProvider } from './gemini-provider';
import { lmstudioProvider } from './lmstudio-provider';

registerProvider(claudeProvider);
registerProvider(geminiProvider);
registerProvider(lmstudioProvider);
