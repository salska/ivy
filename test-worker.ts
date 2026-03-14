import { Blackboard } from './src/runtime/blackboard.ts';
import { buildPromptPreamble } from './src/runtime/tool-adapter/index.ts';

// Just testing the preamble directly here as imported by dispatch-worker
console.log("Preamble:");
console.log(buildPromptPreamble());
