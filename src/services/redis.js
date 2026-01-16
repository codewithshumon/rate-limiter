import redis from 'redis';

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.hasLoggedError = false;
  }

  async connect() {
    try {
      this.client = redis.createClient({
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          connectTimeout: 2000,
          lazyConnect: true
        }
      });

      this.client.on('error', (err) => {
        if (!this.hasLoggedError) {
          console.warn('⚠️  Redis unavailable - using in-memory fallback');
          this.hasLoggedError = true;
        }
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('✅ Redis connected');
      });

      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis connection timeout')), 2000)
        )
      ]);
      
      return this.client;
    } catch (error) {
      if (!this.hasLoggedError) {
        console.warn('⚠️  Redis unavailable - using in-memory fallback');
        this.hasLoggedError = true;
      }
      this.isConnected = false;
      this.client = null;
      return null;
    }
  }

  getClient() {
    return this.client;
  }

  isHealthy() {
    return this.isConnected && this.client && this.client.isOpen;
  }

  async disconnect() {
    if (this.client && this.client.isOpen) {
      await this.client.disconnect();
    }
  }
}

export default new RedisClient();