
import { expect, test, describe } from "bun:test";
import { stripBoilerplate } from "../src/runtime/scheduler/persona-loader";

describe("Boilerplate Stripping Regression", () => {
    test("strips new markers case-insensitively", () => {
        const input = `
# Architect
I am a builder.

## Strategic Planning with /plan Mode
This should be stripped.

## Project State and Session Recovery
This should also be stripped.

## KEEP ME
This should remain.
`.trim();
        
        const output = stripBoilerplate(input);
        expect(output).toContain("I am a builder.");
        expect(output).toContain("KEEP ME");
        expect(output).not.toContain("/plan Mode");
        expect(output).not.toContain("Session Recovery");
    });

    test("strips sections with case variations in markers", () => {
        const input = `
# Engineer
identity stuff

## Step-by-Step Instructions
1. do this
2. do that

## planning and coordination
who does what
`.trim();

        const output = stripBoilerplate(input);
        expect(output).toContain("identity stuff");
        expect(output).not.toContain("Step-by-Step");
        expect(output).not.toContain("planning and coordination");
    });
});
