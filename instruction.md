# Smart Rate Limiting Service - Technical Assessment

## Test Overview

**Duration:** 2 Hours (preferred), with flexibility if more time is needed. The intention is to see the result of your work.

**Focus:** Real-world backend challenges that require architectural thinking, not just syntax proficiency.

---

## Test Structure

The assessment is divided into three main parts, each designed to evaluate different aspects of your technical abilities:

| Part | Focus Area | Time Allocation |
|------|------------|-----------------|
| Part 1 | Core Implementation | 60 minutes |
| Part 2 | Optimization & Edge Cases | 40 minutes |
| Part 3 | System Design Question | 20 minutes |

---

## The Problem: "Smart Rate Limiting Service"

### Problem Statement

You are building a rate limiting service for an e-commerce platform. The platform has several characteristics that make rate limiting complex and interesting:

**User Tiers:** The platform serves three distinct user tiers with different access levels. Free users have the most restrictive limits, Premium users get enhanced access, and Enterprise customers receive the highest allocation with custom agreements.

**Endpoint Variations:** Different API endpoints require different rate limiting strategies. The search endpoint experiences high request volumes as users browse products. The checkout endpoint requires strict limits for fraud prevention. The profile endpoint sits somewhere in between with moderate limits.

**Geographic Considerations:** Users in different geographic regions may receive different rate limits based on regional agreements, regulatory requirements, or business decisions.

**Burst Support:** The system should allow short bursts above the normal rate limit to handle traffic spikes while still maintaining overall protection against abuse.

### Task Overview

The following five tasks will guide you through implementing this rate limiting service:

| Task | Description | Time Allocation |
|------|-------------|-----------------|
| Task 1 | Implement Core Rate Limiting | 30 minutes |
| Task 2 | Handle Edge Cases & Race Conditions | 20 minutes |
| Task 3 | Add Analytics & Monitoring | 10 minutes |
| Task 4 | Optimization Challenge | 15 minutes |
| Task 5 | System Design Question | 20 minutes |

---

## Task 1: Implement Core Rate Limiting (30 minutes)

### Requirements

Implement a rate limiter using the token bucket algorithm with burst support. The implementation should incorporate the following requirements:

**Token Bucket Algorithm with Burst Support:** The token bucket algorithm allows for controlled bursts of traffic while maintaining an average rate limit. Each request consumes tokens from the bucket, and tokens are added at a fixed rate up to the bucket capacity. When the bucket is empty, requests are denied until tokens are replenished.

**Sliding Window Approach:** Implement a sliding window algorithm to track request rates over time. This approach provides smoother rate limiting compared to fixed windows and reduces the impact of burst traffic at window boundaries.

**Tier-Based Multipliers:** Apply multipliers based on user tier. For example, Free users might have a 1x multiplier, Premium users 2x, and Enterprise users 5x or more. These multipliers should be configurable.

**Geographic Multipliers:** Apply multipliers based on user geographic region. Different regions may have different base limits or multipliers applied to the standard limits.

### Response Format

All rate limiting decisions should return a response object with the following structure:

```json
{
  "allowed": true,
  "remaining": 100,
  "retryAfter": 0
}
```

- **allowed:** Boolean indicating whether the request is permitted
- **remaining:** Number of requests remaining in the current window
- **retryAfter:** Number of seconds until the next request will be allowed (when denied)

### Implementation Guidance

Consider the following when implementing:

1. **Configuration Management:** Limits should be configurable, not hardcoded. Use a configuration object or service to retrieve tier, endpoint, and region settings.

2. **Redis Key Design:** Design Redis keys that incorporate user ID, endpoint, and time window. Consider using hash structures to minimize the number of keys.

3. **Atomic Operations:** Use Redis atomic operations (Lua scripts or MULTI/EXEC) to prevent race conditions during token operations.

4. **Burst Handling:** Configure maximum bucket capacity to allow short bursts while still maintaining overall rate control.

---

## Task 2: Handle Edge Cases & Race Conditions (20 minutes)

### Requirements

Real-world systems must handle various edge cases and concurrency scenarios gracefully. Implement handling for the following:

**Multiple Concurrent Requests from Same User:** When multiple requests arrive simultaneously from the same user, the rate limiter must handle them correctly without race conditions. All concurrent requests should see a consistent view of the token bucket state.

**Redis Connection Failures:** Implement fallback mechanisms when Redis is unavailable. The system should degrade gracefully—either by using local caching, implementing a fail-open or fail-closed strategy, or queuing requests for later processing.

**Configuration Changes Mid-Window:** Handle scenarios where rate limit configurations change while a user is in the middle of a rate limit window. The system should apply changes smoothly without unfairly denying requests.

**Clock Skew Between Servers:** In distributed systems, different servers may have slightly different clock times. Design the rate limiter to be resilient to minor clock skew between servers accessing shared Redis storage.

### Implementation Considerations

For each edge case, consider:

1. **What happens to user experience when the edge case occurs?**
2. **How does the system recover once the issue is resolved?**
3. **What metrics or logs should be recorded for debugging?**

---

## Task 3: Add Analytics & Monitoring (10 minutes)

### Requirements

A production rate limiting service needs robust analytics and monitoring to understand usage patterns and detect issues.

**Track Rate Limit Hits:** Record statistics on rate limit hits organized by endpoint, user tier, and geographic region. This data helps identify abuse patterns and informs capacity planning.

**Slow-Start for New Users:** Implement a gradual ramp-up mechanism for new users. New users start with conservative limits that increase over time as they demonstrate legitimate usage patterns. This approach reduces the impact of potential abuse while not penalizing legitimate new users.

**Security Review Logging:** Add optional logging for security review purposes. Log denied requests with relevant context (user ID, endpoint, timestamp, reason) to support security investigations and compliance requirements.

### Implementation Guidance

Consider using:

1. **Separate Redis counters** or time-series data structures for analytics
2. **Asynchronous logging** to avoid impacting rate limiting performance
3. **Configurable logging levels** to control verbosity in production
4. **Sampling strategies** for high-volume logging scenarios

---

## Task 4: Optimization Challenge (15 minutes)

### Requirements

Optimize the rate limiter for performance and efficiency in high-traffic scenarios.

**Reduce Redis Calls:** The current implementation should use 1 Redis call per check. Optimize to reduce Redis calls while maintaining accuracy. Consider batching operations or using Redis pipeline for better efficiency.

**Unlimited Tier Support:** Implement efficient handling for the "unlimited" tier. Users with unlimited access should not incur the overhead of rate limiting checks. Design this as an early exit condition to minimize resource usage.

**Request Cost System:** Different endpoints should have different "weights" or costs. For example, a simple profile read might count as 1 request, while a complex search with aggregations might count as 3-5 requests. Implement a cost system where each request consumes its configured cost from the token bucket.

### Optimization Goals

1. **Minimize Redis round trips:** Each Redis round trip adds latency. Reduce the number of calls where possible.
2. **Reduce memory overhead:** Design efficient data structures that minimize memory usage.
3. **Maintain accuracy:** Optimizations should not compromise the correctness of rate limiting.
4. **Handle scale:** Design should work efficiently at 10K, 100K, and 1M requests per second.

---

## Task 5: System Design Question (20 minutes)

### Written Response Required

Provide a detailed written response to the following system design question:

**Question:** "How would you scale this rate limiter to handle 1 million requests per second globally?"

### Consider the Following Aspects

**Data Partitioning Strategy:** How would you distribute rate limiting data across multiple Redis instances or clusters? Consider consistency vs. availability trade-offs, geographic distribution, and single points of failure.

**Cache Warming/Pre-warming:** How would you ensure rate limit data is available across all servers? Consider cache strategies, prefetching, and cache invalidation patterns.

**Handling DDoS Attacks:** How would you detect and mitigate DDoS attacks? Consider rate limiting at edge locations, graduated response strategies, and distinction between legitimate bursts and attacks.

**Monitoring and Alerting:** How would you monitor the health and performance of the rate limiting system? Consider key metrics, alerting thresholds, and dashboards for operations teams.

### Response Format

Provide a written response (500-1000 words) covering:
1. High-level architecture overview
2. Data partitioning approach
3. Performance optimization strategies
4. DDoS mitigation plan
5. Monitoring and observability strategy

---

## Evaluation Criteria

### Technical Implementation (60 points)

| Criterion | Points | Description |
|-----------|--------|-------------|
| Algorithm Correctness | 15 | Token bucket/sliding window correctly implemented with proper mathematical properties |
| Redis Efficiency | 10 | Minimal Redis calls, proper key design, efficient data structures |
| Error Handling | 10 | Graceful degradation, appropriate fallbacks, proper error recovery |
| Concurrency Safety | 10 | Race conditions properly handled with atomic operations |
| Code Quality | 10 | Clean, readable, well-structured, well-documented code |
| Test Coverage | 5 | Edge cases considered, comprehensive test scenarios |

### Architecture & Design (40 points)

| Criterion | Points | Description |
|-----------|--------|-------------|
| Scalability Considerations | 10 | Horizontal scaling thought through, can grow with traffic |
| Extensibility | 10 | Easy to add new tiers/endpoints/regions without major refactoring |
| Monitoring & Observability | 10 | Logging, metrics, alerts for operational visibility |
| Trade-off Awareness | 10 | Understands and articulates memory vs CPU vs network trade-offs |

### Bonus Points (up to 10 points)

Additional credit will be awarded for:

- Implementing request costing where different endpoints have different weights
- Adding adaptive rate limiting based on user behavior patterns
- Implementing jitter or backoff strategies for rate-limited clients
- Providing clear comments explaining design decisions and trade-offs

---

## Red Flags

The following will result in point deductions or failure:

- **No handling of race conditions:** Concurrency bugs will cause incorrect rate limiting
- **Hardcoded limits:** All limits should be configurable through a configuration system
- **No error handling for Redis failures:** The system must handle Redis unavailability gracefully
- **O(N) Redis calls per request:** Each request should use constant or near-constant Redis operations
- **Cannot explain scaling strategy:** Must be able to articulate how the system would scale

---

## Green Flags

The following will result in positive evaluation:

- **Discusses trade-offs:** Articulates why certain design decisions were made and their implications
- **Adds appropriate logging/metrics:** Includes observability for production monitoring
- **Handles edge cases gracefully:** System remains stable under unusual conditions
- **Code is testable and modular:** Clear separation of concerns, easy to unit test
- **Can articulate scaling approach:** Clear understanding of distributed systems challenges

---

## Submission Guidelines

1. **Code Organization:** Organize code into logical modules (configuration, rate limiter core, analytics, utilities)
2. **Documentation:** Include comments explaining complex logic and design decisions
3. **Testing:** Write unit tests for core functionality, especially edge cases
4. **Configuration:** Use a configuration file or structure that allows easy tuning of parameters
5. **Error Handling:** Implement comprehensive error handling with meaningful error messages

---

## Getting Started

1. Read through all tasks before beginning
2. Set up your development environment with Redis access
3. Create a configuration file with tier, endpoint, and region settings
4. Implement the core rate limiting algorithm first
5. Add edge case handling and optimizations
6. Implement monitoring and analytics
7. Write your system design response
8. Review and test your implementation

Good luck!
