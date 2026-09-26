const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  createGlobalFailedLoginLimiter
} = require("../admin-login-limiter");

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function run() {
  const limiter = createGlobalFailedLoginLimiter({
    windowMs: 15 * 60 * 1000,
    max: 4
  });
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.strictEqual(limiter.status().blocked, false, `failed attempt ${attempt + 1} should be allowed`);
      limiter.recordFailure();
    }
    assert.strictEqual(limiter.status().blocked, true, "the fifth failed attempt should be blocked");
    assert.ok(limiter.status().retryAfter >= 1);
  } finally {
    limiter.close();
  }

  const successLimiter = createGlobalFailedLoginLimiter({
    windowMs: 15 * 60 * 1000,
    max: 4
  });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      successLimiter.recordFailure();
    }
    assert.strictEqual(successLimiter.status().blocked, false);
    // A successful password comparison does not call recordFailure().
    assert.strictEqual(successLimiter.status().blocked, false);
    successLimiter.recordFailure();
    assert.strictEqual(successLimiter.status().blocked, true);
  } finally {
    successLimiter.close();
  }

  const expiringLimiter = createGlobalFailedLoginLimiter({
    windowMs: 25,
    max: 4
  });
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expiringLimiter.recordFailure();
    }
    assert.strictEqual(expiringLimiter.status().blocked, true);
    await wait(40);
    assert.strictEqual(expiringLimiter.status().blocked, false);
  } finally {
    expiringLimiter.close();
  }

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /const loginRateLimiter = createRateLimiter\(\{[\s\S]*?name: 'login',[\s\S]*?windowMs: 15 \* 60 \* 1000,[\s\S]*?max: 12/);
  assert.match(server, /app\.post\('\/api\/admin\/login', loginRateLimiter/);
  assert.match(server, /globalFailedLoginLimiter\.status\(\)/);
  assert.match(server, /globalFailedLoginLimiter\.recordFailure\(\)/);

  console.log("Admin login security checks passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});