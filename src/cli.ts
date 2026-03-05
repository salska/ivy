#!/usr/bin/env bun

/**
 * ivy CLI — entry point shim.
 *
 * Delegates to src/runtime/cli.ts which contains the full
 * unified CLI with all kernel + runtime commands.
 */
import './runtime/cli.ts';
