import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import * as resources from "@opentelemetry/resources";
import * as semanticConventions from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import * as opentelemetry from "@opentelemetry/api";

const { resourceFromAttributes } = resources;
const { SemanticResourceAttributes } = semanticConventions;

/**
 * Production-ready instrumentation for the Semantic Cache Layer.
 * Adheres to "The Observer's Neutrality" principle (< 1ms overhead).
 */
export const setupInstrumentation = () => {
  const resource = resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: "semantic-cache-layer",
    [SemanticResourceAttributes.SERVICE_VERSION]: "0.1.0",
    "env": process.env.NODE_ENV || "development",
  });

  const traceExporter = new OTLPTraceExporter();
  const metricExporter = new OTLPMetricExporter();

  const sdk = new NodeSDK({
    resource: resource,
    spanProcessor: new BatchSpanProcessor(traceExporter, {
        maxQueueSize: 2048,
        scheduledDelayMillis: 1000,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60000,
    }),
  });

  sdk.start();

  console.log("OpenTelemetry Production Instrumentation initialized.");

  process.on("SIGTERM", () => {
    sdk.shutdown().finally(() => process.exit(0));
  });
};

export const tracer = opentelemetry.trace.getTracer("semantic-cache-middleware");
export const meter = opentelemetry.metrics.getMeter("semantic-cache-middleware");

// Task 1.2: Define custom semantic metrics
export const similarityScoreHistogram = meter.createHistogram("semantic_hit_similarity_score", {
  description: "Similarity score distribution of semantic cache hits",
  advice: {
    explicitBucketBoundaries: [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.98, 1.0],
  },
});

export const entryAgeHistogram = meter.createHistogram("semantic_entry_age_seconds", {
  description: "Age distribution of cached entries served",
  unit: "s",
  advice: {
    explicitBucketBoundaries: [60, 3600, 86400, 604800, 2592000], // 1m, 1h, 1d, 1w, 30d
  },
});
