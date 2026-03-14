import { buildPromptPreamble, registerProvider } from './src/runtime/tool-adapter/adapter.ts';
import { geminiProvider } from './src/runtime/tool-adapter/gemini-provider.ts';
registerProvider(geminiProvider);
console.log(buildPromptPreamble());
