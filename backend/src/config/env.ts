const VALID_LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"];
const VALID_NODE_ENVS = ["development", "staging", "production", "test"];

function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.trim().length < minLength) {
    throw new Error(
      `Missing or invalid env var: ${name} (must be at least ${minLength} chars)`
    );
  }
  return value;
}

function requireUrl(name: string): string {
  const value = requireEnv(name);
  try {
    new URL(value);
    return value;
  } catch {
    throw new Error(`Invalid URL for env var: ${name}`);
  }
}

function requireHex(name: string): string {
  const value = requireEnv(name);
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Invalid hex format for env var: ${name}`);
  }
  return value;
}

export function validateEnv(): void {
  // Auth & secrets
  requireEnv("JWT_SECRET", 32);
  requireEnv("QR_SIGNING_PRIVATE_KEY", 32);

  // Stripe
  const stripeKey = requireEnv("STRIPE_SECRET_KEY");
  if (!stripeKey.startsWith("sk_")) {
    throw new Error("STRIPE_SECRET_KEY must start with 'sk_'");
  }
  requireEnv("STRIPE_WEBHOOK_SECRET");

  // Starknet keys & addresses
  requireHex("DEPLOYER_PRIVATE_KEY");
  requireHex("DEPLOYER_ADDRESS");
  requireHex("FACTORY_ADDRESS");
  requireHex("MARKETPLACE_ADDRESS");

  // Infrastructure
  requireEnv("DATABASE_URL");
  requireEnv("REDIS_URL");
  requireUrl("FRONTEND_URL");

  // Optional but validated if set
  const logLevel = process.env.LOG_LEVEL;
  if (logLevel && !VALID_LOG_LEVELS.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}. Must be one of: ${VALID_LOG_LEVELS.join(", ")}`);
  }

  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv && !VALID_NODE_ENVS.includes(nodeEnv)) {
    throw new Error(`Invalid NODE_ENV: ${nodeEnv}. Must be one of: ${VALID_NODE_ENVS.join(", ")}`);
  }

  const rpcUrl = process.env.STARKNET_RPC_URL;
  if (rpcUrl) {
    try {
      new URL(rpcUrl);
    } catch {
      throw new Error("Invalid STARKNET_RPC_URL: must be a valid URL");
    }
  }
}
