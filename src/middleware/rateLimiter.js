import rateLimiter from '../services/rateLimiter.js';

async function rateLimitMiddleware(req, res, next) {
  try {
    const userId = req.headers['x-user-id'] || req.ip;
    const tier = req.headers['x-user-tier'] || 'free';
    const region = req.headers['x-user-region'] || 'default';
    const requestCost = parseInt(req.headers['x-request-cost']) || 1;
    const endpoint = req.path;

    const result = await rateLimiter.checkRateLimit(
      userId,
      endpoint,
      tier,
      region,
      requestCost
    );

    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Limit', result.remaining + (result.allowed ? 1 : 0));

    if (!result.allowed) {
      const jitter = Math.random() * 0.2 * result.retryAfter;
      const retryAfter = Math.ceil(result.retryAfter + jitter);
      
      res.setHeader('Retry-After', retryAfter);
      res.setHeader('X-RateLimit-Reset', Date.now() + (retryAfter * 1000));
      
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
        retryAfter
      });
    }

    next();
  } catch (error) {
    console.error('Rate limit middleware error:', error);
    next();
  }
}

export default rateLimitMiddleware;