# Semantic Cache Monitoring: Architectural Principles

## 1. Constitutional Principles
These principles govern the design of the monitoring layer to ensure it remains a neutral, high-fidelity observer of the system's semantic health.

### 1.1 The Observer's Neutrality (Latency Constraint)
Monitoring is itself a form of overhead. 
- **Mandate**: The instrumentation of the `SemanticCacheMiddleware` must contribute < 1ms to the total lookup latency. 
- **Action**: Metrics collection must be asynchronous and non-blocking (e.g., UDP-based statsd or backgrounded OpenTelemetry exports).

### 1.2 The Semantic Precision Principle
Standard infrastructure metrics (CPU/RAM) are insufficient for a semantic cache. 
- **Constraint**: We must monitor the **Distribution of Confidence**. 
- **Action**: Track the distance between `Similarity(Q_new, Q_cached)` and the dynamic threshold $\epsilon_{min}(t)$. A clustering of hits near the threshold indicates "Semantic Fragility."

### 1.3 Perceptual Budget Accountability
The dashboard must hold the system accountable to the $0.2 \times TTFT_{LLM}$ rule defined in `architecture.md`.
- **Principle**: If the cache overhead exceeds the budget, the dashboard must flag this as an "Architectural Regression" even if the system is technically "healthy."

### 1.4 The Feedback Loop Integrity
Monitoring is the input for the "Feedback-Driven Thresholding" system.
- **Mandate**: Every negative feedback event must be correlated with the specific similarity score and vector cluster at the time of the hit to enable automated threshold tightening.

## 2. Monitoring Taxonomy

### 2.1 Operational Health (The "How")
- **Throughput**: Requests per second (RPS) partitioned by `Hit`, `Partial-Hit`, and `Miss`.
- **Latency Breakdown**: P50/P95/P99 for:
  - Redis (Exact Match)
  - Embedding Generation
  - Qdrant Search
  - Scoring Engine (Threshold calculation)
- **Error Rates**: Connectivity issues with Qdrant, Redis, or the Embedding Provider (OpenAI/Local).

### 2.2 Semantic Health (The "What")
- **Similarity Score Distribution**: Histogram of similarity scores for all cache hits.
- **Threshold Proximity**: Delta between hit similarity and the dynamic $\epsilon_{min}$.
- **Vector Space Density**: Growth rate of the Qdrant collection and its impact on search latency (HNSW efficiency).
- **Staleness Heatmap**: Age distribution of cached entries being served.

### 2.3 Economic Health (The "Why")
- **Token Savings**: Cumulative LLM tokens saved vs. Embedding tokens spent.
- **Cost Efficiency Ratio**: \$ saved (LLM inference) / \$ spent (Embeddings + Infrastructure).

## 3. Implementation Strategy
- **Instrumentation**: OpenTelemetry (OTel) for distributed tracing and metrics.
- **Aggregation**: Prometheus for time-series data; Loki for log-based feedback correlation.
- **Visualization**: Custom React-based "Ivory Blackboard" dashboard for high-level semantic insights; Grafana for deep operational debugging.
