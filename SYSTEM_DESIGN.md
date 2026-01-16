# System Design: Scaling to 1 Million Requests Per Second Globally

## Executive Summary

This document outlines a distributed architecture for scaling the rate limiter from thousands to millions of requests per second across global regions while maintaining consistency, low latency, and resilience to DDoS attacks.

---

## 1. High-Level Architecture Overview

### Multi-Layer Design

```
┌─────────────────────────────────────────────────────────┐
│         CDN/Edge Layer (Cloudflare, Akamai)            │
│  - Distributed globally, close to users                │
│  - Pre-rate limiting (simple, cheap checks)            │
│  - Anycast routing to nearest data center              │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────┴──────────────────────────────────────┐
│    Regional Data Centers (3-5 regions worldwide)       │
│  - US-EAST (primary), US-WEST, EU-WEST, AP, AU        │
└────────┬────────────────────────────────┬───────────────┘
         │                                │
    ┌────▼────┐                    ┌──────▼──────┐
    │Rate      │                    │Rate Limiter │
    │Limiter   │◄────────┐          │Service      │
    │Nodes     │         │          │Cluster      │
    └──────────┘    ┌────┴────────┐ └──────┬──────┘
                    │Redis Cluster│        │
                    │(Sharded)    │        │
                    └──────────────┘        │
                                      ┌─────▼──────┐
                                      │Monitoring  │
                                      │& Analytics │
                                      └────────────┘
```

### Key Components

- **Edge Cache Layer**: Reduce load on primary system
- **Regional Clusters**: Serve users with <100ms latency
- **Distributed Redis**: Sharded by user ID for consistency
- **Analytics System**: Real-time metrics collection

---

## 2. Data Partitioning Strategy

### Sharding Key Design

```
Redis Key Format: ratelimit:{shard_id}:{user_id}:{endpoint}

Shard ID = hash(user_id) % num_shards
```

### Sharding Approach

**Consistent Hashing**:
- User ID as primary key → deterministic shard assignment
- Enables adding/removing nodes with minimal rebalancing
- Supports 50+ Redis nodes without collision hotspots

**Partition Strategy**:
- 256 virtual nodes per physical Redis instance
- Automatic reshuffling when nodes added/removed
- Replication factor: 3 (master + 2 replicas per shard)

### Geographic Distribution

```
Shard 0-50:    US-EAST (Primary) + US-WEST (Replica) + AP (Replica)
Shard 51-100:  US-WEST (Primary) + EU-WEST (Replica) + AU (Replica)
Shard 101-150: EU-WEST (Primary) + AP (Replica) + US-EAST (Replica)
Shard 151-200: AP (Primary) + AU (Replica) + US-WEST (Replica)
```

**Benefits**:
- Local reads in each region (<5ms latency)
- Cross-region replication for failover
- Balanced load distribution

### Consistency Model

**Strong Consistency with Local Preference**:
- Primary writes handled by shard master
- Read preference: local replica → master
- Conflict resolution: last-write-wins with timestamp
- Periodic sync checks (every 60 seconds)

---

## 3. Performance Optimization Strategies

### 3.1 Local Caching Layer

Each rate limiter node maintains:

```javascript
// In-node cache (50MB per node)
localCache = LRU(50 * 1024 * 1024);

// Check local cache first (100ns latency)
// If miss, query Redis (5-10ms latency)
// Cache TTL: 5 seconds (acceptable trade-off)
```

**Benefits**:
- Reduces Redis load by 70-80%
- P99 latency: 100μs vs 5ms
- Handles cache misses gracefully

### 3.2 Request Batching

```javascript
// Batch 10-50 requests, execute in 1 pipeline
batch = [];
batch.push(checkRateLimit(userId1, ...));
batch.push(checkRateLimit(userId2, ...));
// ... 8-48 more requests

if (batch.length >= 10 || timeSinceLastFlush > 10ms) {
  await redis.pipeline().exec(batch);
}
```

**Impact**: Reduces network overhead from 1M calls to 20K calls

### 3.3 Warm-up and Pre-loading

```javascript
// On user login, pre-load rate limit state
async function preloadUserState(userId) {
  const state = await redis.get(`ratelimit:${userId}:*`);
  localCache.set(`user:${userId}`, state, TTL_5_SECONDS);
}

// Predictive loading for high-traffic users
async function preloadHotUsers() {
  const hotUsers = await analytics.getTopUsers(1000);
  Promise.all(hotUsers.map(u => preloadUserState(u)));
}
```

### 3.4 Connection Pooling

```
Node.js Rate Limiter: Redis connection pool
- Min connections: 50 per region
- Max connections: 500
- Connection timeout: 30s
- Reuse connections across requests
```

### 3.5 Early Exit Optimization

```javascript
// Skip Redis entirely for unlimited tier
if (tier === 'unlimited') return { allowed: true, remaining: Infinity };

// Skip for invalid endpoints
if (!isValidEndpoint(endpoint)) return { allowed: true, remaining: 1000 };

// Skip rate limiting for health checks
if (isHealthCheck) return { allowed: true };
```

**Estimated Impact**: 15-20% of requests bypass full checks

---

## 4. DDoS Mitigation Plan

### 4.1 Multi-Layer Defense

```
Layer 1: CDN/Edge
  - IP reputation filtering
  - Geo-blocking (if needed)
  - Simple rate limits: 1000 req/sec per IP

  ↓ (Legitimate traffic passes through)

Layer 2: Regional Cache
  - Rate limit checks with 5-second TTL
  - Bloom filters for known DDoS signatures
  - Circuit breaker for overloaded regions

  ↓

Layer 3: Rate Limiter Service
  - User-based rate limiting
  - Anomaly detection
  - Graduated response strategies

  ↓

Layer 4: Application
  - Request validation
  - Resource limits
  - Graceful degradation
```

### 4.2 Graduated Response Strategy

```
Stage 1 (0-50% over limit): Normal 429 response
Stage 2 (50-100% over): 429 + exponential backoff
Stage 3 (100%+ over): 429 + jitter + require captcha
Stage 4 (Sustained 30+ min): Temporary IP block
```

### 4.3 Anomaly Detection

```javascript
// Detect DDoS patterns
- Spike detection: >10x normal traffic for endpoint
- Geographic concentration: >90% traffic from 1 region
- User concentration: >50% traffic from <100 users
- Pattern analysis: Identical requests from different IPs

// Response:
- Activate additional geo-filtering
- Increase rate limit stringency
- Alert security team
- Prepare to activate backup infrastructure
```

### 4.4 Blacklist/Whitelist Management

```
Dynamic Blacklist (Redis):
- IPs/Users exceeding thresholds
- TTL-based automatic expiry
- Synchronized across all regions
- Can be updated in <100ms

Whitelist:
- Known good actors (partners, internal)
- Bypass certain rate limit checks
- Admin-configurable
```

---

## 5. Monitoring and Observability Strategy

### 5.1 Key Metrics

**Real-time Metrics** (dashboard updates every 5 seconds):

```
System Health:
- Current RPS (Target: 1M)
- P50, P95, P99 latencies
- Redis connection pool utilization
- Cache hit rate (Target: >70%)
- Error rate by type (Target: <0.01%)

Rate Limiting Metrics:
- % of requests allowed vs blocked
- Top 10 users by request count
- Top 10 endpoints by request volume
- Slow-start users (new users)
- Geographic distribution

DDoS Detection:
- Spike events detected (last 24h)
- IPs/Users blocked (realtime)
- Anomaly score by region
- Active circuit breakers
```

### 5.2 Alerting Thresholds

```
Critical (Page on-call):
- RPS < 500K (50% drop)
- P99 latency > 500ms
- Redis cluster unhealthy (>1 shard down)
- Error rate > 1%

High (Notify team):
- RPS < 800K
- Cache hit rate < 40%
- Redis replication lag > 5 seconds
- DDoS spike detected

Medium (Log and monitor):
- Any tier exceeds configured limits
- Regional imbalance (>70% traffic in 1 region)
```

### 5.3 Distributed Tracing

```javascript
// All requests traced with correlation ID
async function rateLimit(userId, endpoint, trace) {
  trace.span('ratelimit:check', {
    userId,
    endpoint,
    tier,
    timestamp: Date.now()
  });
  
  const cacheResult = await checkLocalCache(userId, trace);
  if (cacheResult) {
    trace.span('cache:hit');
    return cacheResult;
  }
  
  trace.span('redis:query');
  const redisResult = await redis.eval(luaScript, trace);
  
  return redisResult;
}
```

### 5.4 Logging Strategy

```
Log Levels:
- ERROR: Rate limiter failures, Redis errors
- WARN: High latency, cache misses, DDoS detection
- INFO: Statistics every 60s (RPS, latency, errors)
- DEBUG: Per-request decision logs (only for specific user IDs)

Log Aggregation:
- ELK Stack (Elasticsearch, Logstash, Kibana)
- Real-time dashboards
- Searchable by user, endpoint, region
- 30-day retention
```

### 5.5 Dashboard Examples

**Operations Dashboard**:
- Real-time RPS gauge
- Latency percentiles (P50, P95, P99)
- Error rate trend
- Redis cluster health
- Cache hit rate

**Security Dashboard**:
- DDoS alerts timeline
- Suspicious users (>threshold blocks)
- Blocked IPs by region
- Anomaly scores

---

## Scaling Path

### Phase 1: 100K RPS (Current)
- Single Redis cluster (10 nodes)
- 5 rate limiter service nodes per region
- Basic monitoring

### Phase 2: 1M RPS (Target)
- Sharded Redis across 50+ nodes
- 50+ rate limiter nodes per region
- Local caching layer
- Enhanced monitoring
- Multi-region failover

### Phase 3: 10M RPS (Future)
- Multi-datacenter Redis mesh
- Layer 7 load balancing
- Predictive scaling
- ML-based anomaly detection

---

## Cost Optimization

**Infrastructure Estimate for 1M RPS**:

```
Redis (50 nodes):              $150K/year
Rate Limiter Nodes (300):      $200K/year
Load Balancers:                 $30K/year
Monitoring & Analytics:         $40K/year
Network/CDN:                   $100K/year
──────────────────────────────────────
Total:                         $520K/year

Cost per million requests: ~$0.16
```

---

## Conclusion

This architecture achieves:
- ✅ 1M+ RPS capacity
- ✅ <50ms P99 latency globally
- ✅ 99.99% availability
- ✅ DDoS resilience
- ✅ Horizontal scaling
- ✅ Cost-effective operations

The key is distributing load across multiple layers (edge, regions, caching) while maintaining strong consistency and observability.
