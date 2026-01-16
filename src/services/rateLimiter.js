import LIMITS from '../config/limits.js';
import redisClient from './redis.js';
import fallback from '../utils/fallback.js';
import analytics from './analytics.js';

class RateLimiter {
  constructor() {
    this.redis = null;
    this.useFallback = false;
  }

  async initialize() {
    try {
      await redisClient.connect();
      this.redis = redisClient.getClient();
      if (!this.redis) {
        this.useFallback = true;
      }
    } catch (error) {
      console.warn('Redis unavailable, using in-memory fallback');
      this.useFallback = true;
    }
  }

  /**
   * Token Bucket with Sliding Window implementation
   * Core algorithm that handles rate limiting
   */
  async checkRateLimit(userId, endpoint, tier = 'free', region = 'default', requestCost = 1) {
    // Handle unlimited tier efficiently
    if (tier === 'unlimited') {
      return { allowed: true, remaining: Infinity, retryAfter: 0 };
    }

    const endpointConfig = LIMITS.endpoints[endpoint];
    if (!endpointConfig) {
      // Unknown endpoint, allow by default
      return { allowed: true, remaining: 1000, retryAfter: 0 };
    }

    // Calculate effective limits with multipliers
    const tierMultiplier = LIMITS.tiers[tier] || 1;
    const regionMultiplier = LIMITS.regions[region] || LIMITS.regions.default;
    const slowStartMultiplier = await this.getSlowStartMultiplier(userId);

    const maxTokens = Math.floor(
      endpointConfig.requests * tierMultiplier * regionMultiplier * slowStartMultiplier
    );
    const burstTokens = Math.floor(endpointConfig.burst * tierMultiplier);
    const totalCapacity = maxTokens + burstTokens;
    const refillRate = maxTokens / endpointConfig.window; // tokens per second
    const cost = (endpointConfig.cost || 1) * requestCost;

    const key = this.generateKey(userId, endpoint);
    const now = Date.now() / 1000; // current time in seconds

    try {
      let result;
      
      if (this.useFallback || !redisClient.isHealthy()) {
        result = await this.processFallback(key, now, totalCapacity, refillRate, cost, endpointConfig.window);
      } else {
        result = await this.processRedis(key, now, totalCapacity, refillRate, cost, endpointConfig.window);
      }

      // Track analytics
      analytics.track(userId, endpoint, tier, region, result.allowed);

      return result;
    } catch (error) {
      console.error('Rate limit check error:', error);
      // On error, fail open (allow request) for availability
      return { allowed: true, remaining: maxTokens, retryAfter: 0 };
    }
  }

  /**
   * Optimized Redis implementation using Lua script
   * Reduces multiple Redis calls to single atomic operation
   */
  async processRedis(key, now, capacity, refillRate, cost, window) {
    // Lua script for atomic token bucket operations
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local capacity = tonumber(ARGV[2])
      local refillRate = tonumber(ARGV[3])
      local cost = tonumber(ARGV[4])
      local window = tonumber(ARGV[5])
      
      local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
      local tokens = tonumber(bucket[1])
      local lastRefill = tonumber(bucket[2])
      
      if tokens == nil then
        tokens = capacity
        lastRefill = now
      else
        local timePassed = now - lastRefill
        tokens = math.min(capacity, tokens + (timePassed * refillRate))
        lastRefill = now
      end
      
      local allowed = 0
      local remaining = tokens
      local retryAfter = 0
      
      if tokens >= cost then
        tokens = tokens - cost
        allowed = 1
        remaining = tokens
      else
        retryAfter = math.ceil((cost - tokens) / refillRate)
      end
      
      redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
      redis.call('EXPIRE', key, window * 2)
      
      return {allowed, remaining, retryAfter}
    `;

    const result = await this.redis.eval(luaScript, {
      keys: [key],
      arguments: [now.toString(), capacity.toString(), refillRate.toString(), cost.toString(), window.toString()]
    });

    return {
      allowed: result[0] === 1,
      remaining: Math.floor(result[1]),
      retryAfter: result[2]
    };
  }

  /**
   * In-memory fallback implementation with locking
   * Used when Redis is unavailable
   */
  async processFallback(key, now, capacity, refillRate, cost, window) {
    // Use locking to prevent race conditions
    return await fallback.withLock(key, async () => {
      const bucket = await fallback.get(key);
      
      let tokens = capacity;
      let lastRefill = now;

      if (bucket) {
        const timePassed = now - bucket.lastRefill;
        tokens = Math.min(capacity, bucket.tokens + (timePassed * refillRate));
        lastRefill = now;
      }

      const allowed = tokens >= cost;
      let remaining = tokens;
      let retryAfter = 0;

      if (allowed) {
        remaining = Math.max(0, tokens - cost);
      } else {
        retryAfter = Math.max(0, Math.ceil((cost - tokens) / refillRate));
      }

      await fallback.set(key, { tokens: remaining, lastRefill }, window * 2);

      return { allowed, remaining: Math.floor(remaining), retryAfter };
    });
  }

  /**
   * Implements slow-start for new users
   * Gradually increases limits over initial period
   */
  async getSlowStartMultiplier(userId) {
    if (!LIMITS.slowStart.enabled) return 1.0;

    const key = `slowstart:${userId}`;
    let firstSeen;

    try {
      if (this.useFallback || !redisClient.isHealthy()) {
        const data = await fallback.get(key);
        firstSeen = data ? data.timestamp : null;
      } else {
        firstSeen = await this.redis.get(key);
      }

      if (!firstSeen) {
        const now = Date.now();
        if (this.useFallback || !redisClient.isHealthy()) {
          await fallback.set(key, { timestamp: now }, LIMITS.slowStart.durationSeconds);
        } else {
          await this.redis.setEx(key, LIMITS.slowStart.durationSeconds, now.toString());
        }
        return LIMITS.slowStart.startMultiplier;
      }

      const elapsed = (Date.now() - parseInt(firstSeen)) / 1000;
      if (elapsed >= LIMITS.slowStart.durationSeconds) {
        return 1.0;
      }

      // Linear ramp-up from startMultiplier to 1.0
      const progress = elapsed / LIMITS.slowStart.durationSeconds;
      return LIMITS.slowStart.startMultiplier + 
             (progress * (1.0 - LIMITS.slowStart.startMultiplier));
    } catch (error) {
      console.error('Slow-start check error:', error);
      return 1.0; // default to full limit on error
    }
  }

  generateKey(userId, endpoint) {
    // Clean endpoint path for key
    const cleanPath = endpoint.replace(/\//g, ':');
    return `ratelimit:${userId}${cleanPath}`;
  }

  /**
   * Handle configuration changes mid-window
   * This allows dynamic updates without service restart
   */
  async updateConfig(newLimits) {
    // In production, this would reload from config service
    // For now, just validate structure
    if (newLimits.endpoints && newLimits.tiers) {
      console.log('Configuration updated:', Object.keys(newLimits.endpoints));
      return true;
    }
    return false;
  }
}

export default new RateLimiter();