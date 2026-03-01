import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateEnv } from "../env";

/**
 * We need to manipulate process.env directly for each test.
 * Save and restore the full env to avoid cross-test pollution.
 */
let savedEnv: NodeJS.ProcessEnv;

function setValidEnv(): void {
  process.env.JWT_SECRET = "a]very-long-jwt-secret-that-is-at-least-32-chars!";
  process.env.QR_SIGNING_PRIVATE_KEY = "qr-signing-key-that-is-at-least-32-chars!!";
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_stripe_key";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";
  process.env.DEPLOYER_PRIVATE_KEY = "0x1234567890abcdef";
  process.env.DEPLOYER_ADDRESS = "0xdeadbeef";
  process.env.FACTORY_ADDRESS = "0xfac700ee";
  process.env.MARKETPLACE_ADDRESS = "0x4a4b5c";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.FRONTEND_URL = "http://localhost:3000";
}

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  process.env = savedEnv;
});

describe("validateEnv", () => {
  it("passes with all valid required env vars", () => {
    setValidEnv();
    expect(() => validateEnv()).not.toThrow();
  });

  it("throws when JWT_SECRET is missing", () => {
    setValidEnv();
    delete process.env.JWT_SECRET;
    expect(() => validateEnv()).toThrow("Missing or invalid env var: JWT_SECRET");
  });

  it("throws when JWT_SECRET is too short (<32 chars)", () => {
    setValidEnv();
    process.env.JWT_SECRET = "short";
    expect(() => validateEnv()).toThrow("Missing or invalid env var: JWT_SECRET");
  });

  it("throws when STRIPE_SECRET_KEY is missing", () => {
    setValidEnv();
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => validateEnv()).toThrow("Missing or invalid env var: STRIPE_SECRET_KEY");
  });

  it("throws when STRIPE_SECRET_KEY does not start with sk_", () => {
    setValidEnv();
    process.env.STRIPE_SECRET_KEY = "pk_test_wrong_prefix";
    expect(() => validateEnv()).toThrow("STRIPE_SECRET_KEY must start with 'sk_'");
  });

  it("throws when DEPLOYER_PRIVATE_KEY is not valid hex", () => {
    setValidEnv();
    process.env.DEPLOYER_PRIVATE_KEY = "not-hex-at-all";
    expect(() => validateEnv()).toThrow("Invalid hex format for env var: DEPLOYER_PRIVATE_KEY");
  });

  it("throws when STARKNET_RPC_URL is invalid", () => {
    setValidEnv();
    process.env.STARKNET_RPC_URL = "not-a-url";
    expect(() => validateEnv()).toThrow("Invalid STARKNET_RPC_URL: must be a valid URL");
  });

  it("throws when LOG_LEVEL is invalid", () => {
    setValidEnv();
    process.env.LOG_LEVEL = "verbose";
    expect(() => validateEnv()).toThrow("Invalid LOG_LEVEL: verbose");
  });

  it("throws when NODE_ENV is invalid", () => {
    setValidEnv();
    process.env.NODE_ENV = "banana";
    expect(() => validateEnv()).toThrow("Invalid NODE_ENV: banana");
  });

  it("throws when VAULT_ADDRESS is not valid hex", () => {
    setValidEnv();
    process.env.VAULT_ADDRESS = "not-hex";
    expect(() => validateEnv()).toThrow("Invalid hex format for env var: VAULT_ADDRESS");
  });
});
