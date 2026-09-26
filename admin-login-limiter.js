function createGlobalFailedLoginLimiter({ windowMs, max }) {
  let bucket = {
    count: 0,
    resetAt: Date.now() + windowMs
  };

  function resetIfExpired(now = Date.now()) {
    if (bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + windowMs
      };
    }
    return bucket;
  }

  const cleanup = setInterval(() => {
    resetIfExpired();
  }, Math.min(windowMs, 60 * 1000));
  cleanup.unref?.();

  return {
    status() {
      const current = resetIfExpired();
      return {
        blocked: current.count >= max,
        retryAfter: Math.max(1, Math.ceil((current.resetAt - Date.now()) / 1000))
      };
    },
    recordFailure() {
      resetIfExpired().count += 1;
    },
    close() {
      clearInterval(cleanup);
    }
  };
}

module.exports = {
  createGlobalFailedLoginLimiter
};