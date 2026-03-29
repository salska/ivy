# Refined Semantic Decay & TTL Policy

A cache hit is a delicate balance of relevance and time. We do not simply "expire" data; we allow it to gracefully recede from relevance.

## 1. The Decay Manifold
We define the **Semantic Relevance Threshold** ($\epsilon$) as a dynamic boundary. As an entry ages, we demand higher similarity for a "hit." This prevents the system from providing "stale" answers that have drifted from current reality.

### 1.1 The Decay Function
For an entry of category $C$, the threshold $\epsilon$ at time $t$ (seconds since creation) is:
$$\epsilon(t, C) = \epsilon_{base}(C) + (1 - \epsilon_{base}(C)) \cdot (1 - e^{-\lambda(C) \cdot t})$$

Where:
- $\epsilon_{base}(C)$: The initial precision required for a hit.
- $\lambda(C)$: The decay constant, determining how fast the threshold tightens.

## 2. Categorical Volatility Profiles
We reject the notion of a single "volatility score." Instead, we define **Profiles** that reflect the inherent nature of the information.

| Profile | $\epsilon_{base}$ | $\lambda$ (approx. Half-life) | Rationale |
| :--- | :--- | :--- | :--- |
| **Immutable** | 0.85 | $10^{-9}$ (Years) | Mathematical truths, historical facts. |
| **Stable** | 0.90 | $10^{-7}$ (Months) | Documentation, biographical data, code snippets. |
| **Dynamic** | 0.94 | $10^{-5}$ (Days) | Software versions, project status, contact info. |
| **Ephemeral** | 0.98 | $10^{-3}$ (Minutes) | Prices, weather, real-time telemetry. |

## 3. The "Graceful Exit" Strategy
When a query falls below the dynamic threshold $\epsilon(t, C)$ but remains above the $\epsilon_{base}(C)$, the system should not simply "miss." It should trigger a **Background Refresh**:
1. Serve the cached response to the user (maintaining the rhythm of interaction).
2. Flag the entry for an asynchronous update from the LLM.
3. Update the cache with the fresh response and reset the decay timer.

This ensures the user *feels* the speed of the cache while the system maintains its integrity.
