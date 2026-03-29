import { describe, test, expect } from "bun:test";
import { isMeaninglessHandover } from "../src/runtime/parser/handover-parser.ts";

describe("handover validation", () => {
  test("isMeaninglessHandover identifies placeholders", () => {
    // Test old placeholders
    expect(isMeaninglessHandover("<what you accomplished>")).toBe(true);
    expect(isMeaninglessHandover("<what still needs to be done>")).toBe(true);
    
    // Test new placeholders
    expect(isMeaninglessHandover("[DESCRIBE_WHAT_YOU_ACCOMPLISHED]")).toBe(true);
    expect(isMeaninglessHandover("DESCRIBE_WHAT_YOU_ACCOMPLISHED")).toBe(true);
    expect(isMeaninglessHandover("  [LIST_REMAINING_STEPS_AND_TODOIS]  ")).toBe(true);
    
    // Test meaningful content
    expect(isMeaninglessHandover("I implemented the login flow and added tests.")).toBe(false);
    expect(isMeaninglessHandover("Next steps: deploy to staging.")).toBe(false);
    expect(isMeaninglessHandover("None")).toBe(false);
  });
});
