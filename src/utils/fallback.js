class InMemoryFallback {
  constructor() {
    this.store = new Map();
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
  }
}

export default new InMemoryFallback();