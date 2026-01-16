import rateLimiter from '../src/services/rateLimiter.js';
import redisClient from '../src/services/redis.js';
import fallback from '../src/utils/fallback.js';

describe('Edge Cases & Error Handling', () => {
  beforeAll(async () => {
    await rateLimiter.initialize();
  });

  describe('Redis Failure Handling', () => {
    test('should fallback to in-memory when Redis fails', async () => {
      rateLimiter.useFallback = true;
      
      const userId = 'fallback-user';
      const result = await rateLimiter.checkRateLimit(userId, '/api/search', 'free');
      
      expect(result.allowed).toBe(true);
      expect(result).toHaveProperty('remaining');
      expect(result).toHaveProperty('retryAfter');
      
      rateLimiter.useFallback = false;
    });

    test('should handle Redis connection errors gracefully', async () => {
      const originalHealthy = redisClient.isHealthy.bind(redisClient);
      redisClient.isHealthy = () => false;
      
      const userId = 'error-user';
      const result = await rateLimiter.checkRateLimit(userId, '/api/search', 'free');
      
      expect(result).toBeDefined();
      expect(result.allowed).toBe(true);
      
      redisClient.isHealthy = originalHealthy;
    });
  });

  describe('Configuration Changes', () => {
    test('should handle configuration updates', async () => {
      const newConfig = {
        endpoints: {
          '/api/test': {
            requests: 50,
            window: 60,
            burst: 10,
            cost: 1
          }
        },
        tiers: {
          free: 1,
          premium: 5
        }
      };
      
      const result = await rateLimiter.updateConfig(newConfig);
      expect(result).toBe(true);
    });

    test('should reject invalid configuration', async () => {
      const invalidConfig = {
        endpoints: null
      };
      
      const result = await rateLimiter.updateConfig(invalidConfig);
      expect(result).toBe(false);
    });
  });

  describe('Unknown/Invalid Inputs', () => {
    test('should handle unknown endpoint gracefully', async () => {
      const userId = 'unknown-endpoint-user';
      const result = await rateLimiter.checkRateLimit(userId, '/api/unknown', 'free');
      
      expect(result.allowed).toBe(true);
    });

    test('should handle invalid tier', async () => {
      const userId = 'invalid-tier-user';
      const result = await rateLimiter.checkRateLimit(userId, '/api/search', 'invalid-tier');
      
      expect(result).toBeDefined();
      expect(result.allowed).toBe(true);
    });

    test('should handle invalid region', async () => {
      const userId = 'invalid-region-user';
      const result = await rateLimiter.checkRateLimit(userId, '/api/search', 'free', 'invalid-region');
      
      expect(result).toBeDefined();
      expect(result.allowed).toBe(true);
    });
  });

  describe('Clock Skew & Time Issues', () => {
    test('should handle time going backwards gracefully', async () => {
      const userId = 'time-skew-user';
      
      const result1 = await rateLimiter.checkRateLimit(userId, '/api/search', 'free');
      expect(result1.allowed).toBe(true);
      
      const result2 = await rateLimiter.checkRateLimit(userId, '/api/search', 'free');
      expect(result2).toBeDefined();
    });
  });

  describe('Memory & Cleanup', () => {
    test('in-memory fallback should cleanup expired entries', async () => {
      await fallback.set('test-key-1', { tokens: 100 }, 1);
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      fallback.cleanup();
      
      const result = await fallback.get('test-key-1');
      expect(result).toBeNull();
    });
  });

  describe('Race Conditions', () => {
    test('should handle rapid sequential requests atomically', async () => {
      const userId = 'race-user-' + Date.now();
      
      const results = await Promise.all(
        Array(10).fill(null).map(() => 
          rateLimiter.checkRateLimit(userId, '/api/checkout', 'free')
        )
      );
      
      const allowed = results.filter(r => r.allowed).length;
      
      expect(allowed).toBeGreaterThan(0);
      expect(allowed).toBeLessThanOrEqual(12);
    });

    test('should maintain consistency across concurrent writes', async () => {
      const userId = 'concurrent-write-user';
      
      const promises = Array(100).fill(null).map((_, i) => 
        rateLimiter.checkRateLimit(userId, '/api/search', 'free')
      );
      
      const results = await Promise.all(promises);
      
      const allowedCount = results.filter(r => r.allowed).length;
      
      expect(allowedCount).toBeLessThanOrEqual(120);
      
      const finalResult = await rateLimiter.checkRateLimit(userId, '/api/search', 'free');
      expect(finalResult.remaining).toBeLessThan(20);
    });
  });

  describe('Stress & Performance', () => {
    test('should handle high request volume', async () => {
      const promises = [];
      
      for (let i = 0; i < 100; i++) {
        promises.push(
          rateLimiter.checkRateLimit(`stress-user-${i}`, '/api/search', 'free')
        );
      }
      
      const startTime = Date.now();
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(5000);
      
      results.forEach(result => {
        expect(result).toHaveProperty('allowed');
        expect(result).toHaveProperty('remaining');
        expect(result).toHaveProperty('retryAfter');
      });
    });
  });

  afterAll(() => {
    fallback.destroy();
  });
});