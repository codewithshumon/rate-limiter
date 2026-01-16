import express from 'express';
import rateLimiter from './services/rateLimiter.js';
import rateLimitMiddleware from './middleware/rateLimitMiddleware.js';
import analytics from './services/analytics.js';

const app = express();
app.use(express.json());

(async () => {
  await rateLimiter.initialize();
  console.log('✅ Rate limiter initialized');
})();

app.use('/api/*', rateLimitMiddleware);

app.get('/api/search', (req, res) => {
  res.json({ message: 'Search results', timestamp: Date.now() });
});

app.post('/api/checkout', (req, res) => {
  res.json({ message: 'Checkout processed', timestamp: Date.now() });
});

app.get('/api/profile', (req, res) => {
  res.json({ message: 'Profile data', timestamp: Date.now() });
});

app.get('/admin/stats', async (req, res) => {
  try {
    const { endpoint, tier, region } = req.query;
    const stats = await analytics.getStats(endpoint, tier, region);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/security-log', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const log = analytics.getSecurityLog(limit);
    res.json({ events: log, count: log.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Rate limiter service running on port ${PORT}`);
});

export default app;