# Health Monitoring Dashboard: Feature Specifications (WHAT/WHY)

## 1. Overview
The Health Monitoring Dashboard is the visual command center for the Semantic Cache Layer. It bridges infrastructure performance with AI-specific semantic metrics.

## 2. Key Features

### 2.1 The "Perceptual Budget" Pulse (WHAT)
**What**: A real-time visualization of the lookup latency budget ($0.2 \times TTFT_{LLM}$).
**Why**: To ensure the cache never becomes a net latency penalty.
- **Component**: A horizontal progress bar ("Latency Bar") showing the breakdown of Redis + Embedding + Qdrant + Scoring.
- **Threshold**: Red line at the 120ms budget mark.

### 2.2 The Semantic Confidence Heatmap (WHAT)
**What**: A 2D visualization of similarity scores over time, plotted against the dynamic decay threshold.
**Why**: To identify "Semantic Drift"—the tendency for cached answers to lose relevance as the world moves on.
- **Visual**: A density plot where X = time, Y = similarity score [0.7 - 1.0], and a dynamic line representing $\epsilon_{min}(t)$.

### 2.3 Cache Efficiency Funnel (WHAT)
**What**: A breakdown of the multi-tier lookup success rate.
**Why**: To optimize the balance between the cheap "Fast Path" (Redis) and the expensive "Semantic Path" (Qdrant).
- **Levels**: Total Requests $\rightarrow$ Hash Match (Redis) $\rightarrow$ Vector Match (Qdrant) $\rightarrow$ LLM Miss.

### 2.4 Token Economic Ledger (WHAT)
**What**: A "Savings" card showing total tokens saved by the cache.
**Why**: To quantify the business and environmental value of the cache layer.
- **Metric**: (Cached Completion Tokens) - (Embedding Generation Tokens).

## 3. Implementation Plan (HOW)

### 3.1 Phase 1: Data Collection & Instrumentation
- [ ] Export `latency_ms` for each phase (Redis, Embedding, Search, Scoring).
- [ ] Log `similarity_score` and `entry_age` for every cache hit.
- [ ] Track `cache_result` enum: `hash_hit`, `semantic_hit`, `miss`.
- [ ] Capture user feedback via a dedicated API endpoint and link it to the `request_id`.

### 3.2 Phase 2: Visualization Layers
- **Operational View (Grafana)**: Standard time-series for RPS, Latency (P95), and Error rates.
- **Semantic View (Custom React Dashboard)**:
  - Utilize the "Ivory Blackboard" design system.
  - Implement the "Confidence Heatmap" using a charting library (e.g., Recharts or D3).
  - Use the `#0071E3` (Primary) for hits and `#FF3B30` (Error) for budget violations.

### 3.3 Phase 3: Alerting & Threshold Tuning
- [ ] Alert on "Semantic Drift": When the average similarity of hits in a namespace drops below a critical point.
- [ ] Alert on "Budget Violation": When P95 lookup latency > 120ms.
- [ ] Auto-reindexing: Trigger an alert if the `embedding_model_version` mismatch is detected.

## 4. Design Components (from `dashboard-design-system.json`)
- **Background**: `#F5F5F7`
- **Metric Cards**: White surface (`#FFFFFF`) with `SF Pro Display` typography.
- **Status Indicators**: `#34C759` (Healthy), `#FF9500` (Degraded), `#FF3B30` (At Risk).

## 5. Success Criteria
- **Observation Overhead**: < 0.5% impact on middleware throughput.
- **Time-to-Insight**: Architect can identify the cause of a cache-hit quality drop in < 2 minutes.
- **Accuracy**: Feedback correlation matches 100% of reported "Wrong Answers."
