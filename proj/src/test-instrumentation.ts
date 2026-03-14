import { setupInstrumentation } from "./instrumentation";
import { SemanticCacheMiddleware } from "./SemanticCacheMiddleware";

// Initialize OpenTelemetry
setupInstrumentation();

async function runBenchmark() {
  const middleware = new SemanticCacheMiddleware();
  const iterations = 1000;
  const prompt = "How do I implement a semantic cache?";

  console.log(`Starting benchmark with ${iterations} iterations...`);
  
  // Warm up
  for (let i = 0; i < 5; i++) {
    await middleware.lookup(prompt);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await middleware.lookup(prompt);
  }
  const end = performance.now();

  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  // Expected base delay from mocks: 5ms + 65ms + 20ms = 90ms
  const baseDelay = 90;
  const overhead = avgTime - baseDelay;

  console.log(`--- Results ---`);
  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per lookup: ${avgTime.toFixed(2)}ms`);
  console.log(`Instrumentation overhead: ${overhead.toFixed(2)}ms`);

  if (overhead < 1) {
    console.log("SUCCESS: Overhead is < 1ms.");
  } else {
    console.log("WARNING: Overhead exceeds 1ms. Review instrumentation strategy.");
  }

  // Allow some time for spans to flush
  console.log("Waiting for spans to flush...");
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
}

runBenchmark().catch(err => {
  console.error(err);
  process.exit(1);
});
