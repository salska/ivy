# Semantic Cache Layer: System Design & Implementation

## 1. Implementation Plans (HOW)

### 1.1 Vector Database Layer (Qdrant)
The "Source of Truth" for semantic memory. Qdrant is selected for its HNSW implementation and strong payload-filtering capabilities.
- **Collection Setup**: 
  - `distance`: Cosine (default for most semantic embeddings).
  - `hnsw_config`: 
    - `m`: 16 (standard for high-dimensional search).
    - `ef_construct`: 128 (trade-off between indexing speed and search accuracy).
- **Schema**:
  - `vector`: 1536-dimensional float array (OpenAI `text-embedding-3-small`).
  - `payload`:
    - `prompt_text`: Original query.
    - `completion`: Cached LLM output.
    - `model_id`: The LLM version (e.g., `gpt-4o-mini`).
    - `volatility_score`: Float [0, 1].
    - `created_at`: Unix timestamp.
    - `last_hit_at`: Unix timestamp (for LRU-style purging).

### 1.2 Multi-Tiered TTL & Dynamic Invalidation Strategy
To combat "Semantic Drift," we implement a three-tiered invalidation mechanism:
1. **Hard Expiry**: A configurable $TTL_{max}$ (e.g., 30 days) after which the entry is purged from the Vector DB.
2. **Semantic Decay Function**: 
   - A "hit" occurs if $Similarity(Q_{new}, Q_{cached}) > \epsilon_{min}$.
   - $\epsilon_{min}$ is not static: $\epsilon_{min}(t) = \epsilon_{baseline} + (1 - \epsilon_{baseline}) \times (1 - e^{-\lambda t})$.
   - This ensures that as an entry ages ($t$), the required similarity threshold approaches 1.0 (exact match only).
3. **Volatility-Aware TTL Assignment**:
   - `Static`: (e.g., "What is Pi?") $\rightarrow$ TTL 1 year.
   - `Semi-Dynamic`: (e.g., "Current version of Node.js") $\rightarrow$ TTL 1 week.
   - `Ephemeral`: (e.g., "Stock price of Apple") $\rightarrow$ TTL 10 minutes.

### 1.3 The Cache Middleware (The Orchestrator)
A high-performance microservice (Rust or Go) sitting between the API Gateway and the LLM.
1. **Pre-Flight Hash**: SHA-256 hash of the prompt for a Redis-based O(1) lookup.
2. **Asynchronous Embedding**: If hash miss, generate embedding via OpenAI API.
3. **Vector Search**: Search Qdrant with the embedding.
4. **Scoring Engine**: Validate the similarity against the **Semantic Decay** function based on the entry's age and volatility.
5. **Proxy/Cache**: 
   - On **Hit**: Return cached `completion`. Log a "cache_hit" event for feedback loops.
   - On **Miss**: Call LLM $\rightarrow$ Cache Response $\rightarrow$ Return to User.

## 2. Risk Assessment & Mitigation
- **Risk**: "The Wrong Answer" (High confidence hit on a semantically distinct but similar query). **Mitigation**: Implement a secondary "exactness" check using a cheap cross-encoder or simple keyword overlap (BM25).
- **Risk**: Embedding Cost. **Mitigation**: Cache the embeddings themselves to avoid re-calculating them for repeated similar queries.
- **Risk**: Vector DB Latency. **Mitigation**: Use HNSW indexing and ensure the Vector DB is co-located with the middleware.

## 3. Task Breakdown

### 3.1 Phase 1: Vector Indexing & Search [P]
- [ ] [P] Setup Qdrant instance with 1536-dim collection.
- [ ] Implement `EmbeddingClient` using OpenAI SDK or local model.
- [ ] Create `VectorStore` adapter for upserting and searching vectors.
- [ ] [P] Benchmarking script for search latency at 10k, 100k, 1M vectors.

### 3.2 Phase 2: Cache Orchestration & Hit Logic [P]
- [ ] Build the `SemanticCacheMiddleware` core logic.
- [ ] Implement the "Exact Match" fast-path using Redis.
- [ ] Define the `SimilarityScorer` with configurable thresholds.
- [ ] [P] Integration test: "Prompt A" and "Prompt B (paraphrased)" should both hit the same cache entry.

### 3.3 Phase 3: Advanced TTL & Metadata
- [ ] Implement the `SemanticDecay` function (Similarity vs. Time).
- [ ] Add `VolatilityClassifier` for dynamic TTL assignment.
- [ ] Implement a background job for periodic stale entry cleanup in the Vector DB.

### 3.4 Phase 4: Observability & Feedback [P]
- [ ] [P] Export metrics: Cache Hit Rate (CHR), Lookup Latency, Embedding Token Usage.
- [ ] Create a "Feedback API" for users to report incorrect semantic hits.
- [ ] [P] Dashboard for monitoring cache efficiency and drift.

## 4. Handover Note
Implementation should start with **Phase 1** and **Phase 2** concurrently. The most critical component is the `SimilarityScorer`, as it determines the balance between efficiency and accuracy. All implementations must adhere to the "Constitutional Principles" in `architecture.md`.
