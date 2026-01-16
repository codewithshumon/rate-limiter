import redis from 'redis';

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = redis.createClient({
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379
        }
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('Redis connected');
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      console.error('Redis connection failed:', error);
      this.isConnected = false;
      throw error;
    }
  }

  getClient() {
    return this.client;
  }

  isHealthy() {
    return this.isConnected && this.client && this.client.isOpen;
  }
}

export default new RedisClient();