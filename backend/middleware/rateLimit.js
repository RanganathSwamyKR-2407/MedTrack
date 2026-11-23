/**
 * Lightweight sliding-window rate limiter for auth and OTP verification protection.
 */
export function createRateLimiter({ windowMs = 60_000, maxRequests = 30, keyFn } = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn ? keyFn(req) : req.ip || "unknown";
    const entry = buckets.get(key) || [];
    const recent = entry.filter((ts) => now - ts < windowMs);

    if (buckets.size > 5000) {
      for (const [bKey, times] of buckets.entries()) {
        if (!times.some((ts) => now - ts < windowMs)) {
          buckets.delete(bKey);
        }
      }
    }

    if (recent.length >= maxRequests) {
      const oldest = recent[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please wait before retrying."
        }
      });
    }

    recent.push(now);
    buckets.set(key, recent);
    next();
  };
}
