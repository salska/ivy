import { resolveProvider, getAdapter, buildPromptPreamble } from './src/runtime/tool-adapter/index.ts';
console.log("Provider:", resolveProvider());
console.log("Adapter Provider:", getAdapter().provider);
console.log(buildPromptPreamble());
