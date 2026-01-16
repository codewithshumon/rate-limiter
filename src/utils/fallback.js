class InMemoryFallback {
  constructor() {
    this.store = new Map();
    this.locks = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async get(key) {
    return this.store.get(key) || null;
  }

  async set(key, value, ttl) {
    this.store.set(key, {
      ...value,
      expiresAt: Date.now() + (ttl * 1000)
    });
  }

  async del(key) {
    this.store.delete(key);
  }

  async acquireLock(key) {
    const lockKey = `lock:${key}`;
    while (this.locks.has(lockKey)) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.locks.set(lockKey, true);
    return () => this.locks.delete(lockKey);
  }

  async withLock(key, fn) {
    const release = await this.acquireLock(key);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.store.entries()) {
      if (value.expiresAt && value.expiresAt < now) {
        this.store.delete(key);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
    this.locks.clear();
  }
}

export default new InMemoryFallback();