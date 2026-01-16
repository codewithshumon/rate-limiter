import redisClient from './redis.js';

class Analytics {
  constructor() {
    this.inMemoryStats = {
      hits: {},
      blocks: {}
    };
    this.securityLog = [];
  }

  async track(userId, endpoint, tier, region, allowed) {
    const timestamp = Date.now();
    const key = `analytics:${endpoint}:${tier}:${region}`;
    
    try {
      if (redisClient.isHealthy()) {
        const statsKey = allowed ? `${key}:allowed` : `${key}:blocked`;
        await redisClient.getClient().incr(statsKey);
        await redisClient.getClient().expire(statsKey, 3600);
      } else {
        const statsObj = allowed ? this.inMemoryStats.hits : this.inMemoryStats.blocks;
        statsObj[key] = (statsObj[key] || 0) + 1;
      }

      if (!allowed) {
        this.logSecurityEvent(userId, endpoint, timestamp);
      }
    } catch (error) {
      console.error('Analytics tracking error:', error);
    }
  }

  logSecurityEvent(userId, endpoint, timestamp) {
    const event = { userId, endpoint, timestamp, type: 'rate_limit_exceeded' };
    
    this.securityLog.push(event);
    
    if (this.securityLog.length > 1000) {
      this.securityLog.shift();
    }

    const recentBlocks = this.securityLog.filter(
      e => e.userId === userId && timestamp - e.timestamp < 60000
    );

    if (recentBlocks.length > 10) {
      console.warn(`⚠️ Suspicious activity detected for user ${userId}: ${recentBlocks.length} rate limit hits in 1 minute`);
    }
  }

  async getStats(endpoint = null, tier = null, region = null) {
    const stats = { allowed: 0, blocked: 0 };

    try {
      if (redisClient.isHealthy()) {
        const pattern = `analytics:${endpoint || '*'}:${tier || '*'}:${region || '*'}:*`;
        const keys = await redisClient.getClient().keys(pattern);

        for (const key of keys) {
          const count = await redisClient.getClient().get(key);
          if (key.endsWith(':allowed')) {
            stats.allowed += parseInt(count || 0);
          } else if (key.endsWith(':blocked')) {
            stats.blocked += parseInt(count || 0);
          }
        }
      } else {
        Object.entries(this.inMemoryStats.hits).forEach(([key, count]) => {
          if (this.matchesPattern(key, endpoint, tier, region)) {
            stats.allowed += count;
          }
        });
        Object.entries(this.inMemoryStats.blocks).forEach(([key, count]) => {
          if (this.matchesPattern(key, endpoint, tier, region)) {
            stats.blocked += count;
          }
        });
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }

    return stats;
  }

  matchesPattern(key, endpoint, tier, region) {
    const parts = key.split(':');
    return (!endpoint || parts[1] === endpoint) &&
           (!tier || parts[2] === tier) &&
           (!region || parts[3] === region);
  }

  getSecurityLog(limit = 100) {
    return this.securityLog.slice(-limit);
  }

  async cleanup() {
    if (redisClient.isHealthy()) {
      const pattern = 'analytics:*';
      const keys = await redisClient.getClient().keys(pattern);
      
      for (const key of keys) {
        const ttl = await redisClient.getClient().ttl(key);
        if (ttl < 0) {
          await redisClient.getClient().del(key);
        }
      }
    }
    
    this.inMemoryStats = { hits: {}, blocks: {} };
  }
}

export default new Analytics();