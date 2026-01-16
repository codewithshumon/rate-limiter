const LIMITS = {
  endpoints: {
    '/api/search': {
      requests: 100,
      window: 60,
      burst: 20, 
      cost: 1 
    },
    '/api/checkout': {
      requests: 10,
      window: 60,
      burst: 2,
      cost: 5 
    },
    '/api/profile': {
      requests: 50,
      window: 60,
      burst: 10,
      cost: 1
    }
  },
  
  tiers: {
    free: 1,
    premium: 3,
    enterprise: 10,
    unlimited: Infinity
  },
  
  regions: {
    'us-east': 1.0,
    'us-west': 1.0,
    'eu-west': 0.8,
    'ap-south': 0.6,
    default: 1.0
  },
  
  slowStart: {
    enabled: true,
    durationSeconds: 300,
    startMultiplier: 0.5
  }
};

export default LIMITS;