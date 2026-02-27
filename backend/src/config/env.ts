function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.trim().length < minLength) {
    throw new Error(
      `Missing or invalid env var: ${name} (must be at least ${minLength} chars)`
    );
  }
  return value;
}

export function validateEnv(): void {
  requireEnv("JWT_SECRET", 32);
  requireEnv("STRIPE_SECRET_KEY");
  requireEnv("STRIPE_WEBHOOK_SECRET");
  requireEnv("QR_SIGNING_PRIVATE_KEY", 32);
  requireEnv("DEPLOYER_PRIVATE_KEY");
  requireEnv("DEPLOYER_ADDRESS");
  requireEnv("FACTORY_ADDRESS");
  requireEnv("MARKETPLACE_ADDRESS");
  requireEnv("DATABASE_URL");
  requireEnv("REDIS_URL");
  requireEnv("FRONTEND_URL");
}
