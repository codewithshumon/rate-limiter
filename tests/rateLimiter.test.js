import rateLimiter from '../src/services/rateLimiter.js';
import redisClient from '../src/services/redis.js';

describe('RateLimiter Core Functionality', () => {
  beforeAll(async () => {
    await rateLimiter.initialize();
  }, 10000);

  afterAll(async () => {
    await redisClient.disconnect();
  });

  describe('Basic Rate Limiting', () => {
    test('should allow requests within limit', async () => {
      const userId = 'test-user-1';
      const result = await rateLimiter.checkRateLimit(userId, '/api/search', 'free');
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    test('should block requests exceeding limit', async () => {
      const userId = 'test-user-2';
      
      for (let i = 0; i < 100; i++) {
        await rateLimiter.checkRateLimit(userId, '/api/search', 'free');
      }
      
      const result = await rateLimiter.checkRateLimit(userId, '/api/search', 'free');
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    test('should handle burst capacity', async () => {
      const userId = 'test-user-burst-' + Date.now();
      let blockedAt = -1;
      
      for (let i = 0; i < 130; i++) { 
        const result = await rateLimiter.checkRateLimit(userId, '/api/search', 'free');
        if (!result.allowed && blockedAt === -1) {
          blockedAt = i;
          break;
        }
      }
      
      expect(blockedAt).toBeGreaterThan(50);
      expect(blockedAt).toBeLessThanOrEqual(70);
    });
  });

  describe('Tier Multipliers', () => {
    test('premium tier should have 3x limits', async () => {
      const freeUser = 'free-user';
      const premiumUser = 'premium-user';
      
      const freeResult = await rateLimiter.checkRateLimit(freeUser, '/api/search', 'free');
      const premiumResult = await rateLimiter.checkRateLimit(premiumUser, '/api/search', 'premium');
      
      expect(premiumResult.remaining).toBeGreaterThan(freeResult.remaining * 2);
    });

    test('unlimited tier should always allow', async () => {
      const unlimitedUser = 'unlimited-user';
      
      for (let i = 0; i < 1000; i++) {
        const result = await rateLimiter.checkRateLimit(unlimitedUser, '/api/search', 'unlimited');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(Infinity);
      }
    });
  });

  describe('Request Cost', () => {
    test('should consume tokens based on request cost', async () => {
      const userId = 'cost-test-user-' + Date.now();
      
      await rateLimiter.checkRateLimit(userId, '/api/search', 'free', 'default', 1);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result1 = await rateLimiter.checkRateLimit(userId, '/api/search', 'free', 'default', 1);
      const result2 = await rateLimiter.checkRateLimit(userId, '/api/search', 'free', 'default', 1);
      
      const consumed = Math.abs(result1.remaining - result2.remaining);
      expect(consumed).toBe(1);
    });

    test('should handle custom request cost multiplier', async () => {
      const userId = 'custom-cost-user';
      
      await rateLimiter.checkRateLimit(userId, '/api/search', 'free', 'default', 3);
      
      const result = await rateLimiter.checkRateLimit(userId, '/api/search', 'free', 'default', 1);
      expect(result.remaining).toBeLessThan(100);
    });
  });

  describe('Geographic Multipliers', () => {
    test('should apply regional limits', async () => {
      const userId = 'geo-user';
      
      const usResult = await rateLimiter.checkRateLimit(userId, '/api/search', 'free', 'us-east');
      const apResult = await rateLimiter.checkRateLimit(userId + '-ap', '/api/search', 'free', 'ap-south');
      
      expect(usResult.remaining).toBeGreaterThan(apResult.remaining);
    });
  });

  describe('Slow Start', () => {
    test('should limit new users initially', async () => {
      const newUser = 'new-user-' + Date.now();
      
      const result = await rateLimiter.checkRateLimit(newUser, '/api/search', 'free');
      
      expect(result.remaining).toBeLessThan(100);
      expect(result.remaining).toBeGreaterThan(45);
    });
  });
});

describe('Concurrent Requests', () => {
  beforeAll(async () => {
    await rateLimiter.initialize();
  }, 10000);

  afterAll(async () => {
    await redisClient.disconnect();
  });

  test('should handle concurrent requests safely', async () => {
    const userId = 'concurrent-user';
    
    const promises = Array(50).fill(null).map(() => 
      rateLimiter.checkRateLimit(userId, '/api/search', 'free')
    );
    
    const results = await Promise.all(promises);
    const allowed = results.filter(r => r.allowed).length;
    
    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThanOrEqual(120);
  });
});