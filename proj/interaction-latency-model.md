# Interaction & Latency Model

A semantic cache is an invisible promise of speed. If it fails that promise, it is worse than useless.

## 1. The Perceptual Budget
We allocate a strict latency budget for the cache overhead.

| Phase | Budget (ms) | Target (ms) | Notes |
| :--- | :--- | :--- | :--- |
| **Exact Match (Redis)** | 5 | 2 | O(1) lookup on SHA-256 hash. |
| **Embedding Generation** | 80 | 45 | Local model or OpenAI `text-embedding-3-small`. |
| **Vector Search (Qdrant)** | 35 | 15 | HNSW search at 1M scale. |
| **Threshold Scoring** | 5 | 1 | Decay function & background refresh check. |
| **TOTAL OVERHEAD** | **125** | **63** | Must be < 20% of LLM TTFT. |

## 2. Interaction Flow
The system must navigate failures with grace.

1. **The Fast Path**: Redis hit $\rightarrow$ Immediate Return. Total time < 5ms.
2. **The Semantic Path**: Redis miss $\rightarrow$ Embedding $\rightarrow$ Vector Search $\rightarrow$ Hit $\rightarrow$ Threshold check.
3. **The Speculative Path**: If Similarity is in the "Background Refresh" buffer (within 2% of threshold), serve cached result immediately but trigger an async LLM update.
4. **The Fail-Safe Path**: If any stage of the cache exceeds its budget, the system MUST abort the cache lookup and proceed to the LLM. We do not stack cache latency on top of LLM latency.

## 3. User Experience of "Staleness"
If the `volatility_profile` is **Ephemeral**, the system should show a "Last updated: X min ago" hint in the UI if the age exceeds 50% of its expected life. This builds trust through transparency.
