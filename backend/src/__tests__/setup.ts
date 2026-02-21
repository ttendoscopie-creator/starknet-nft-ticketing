// Set environment variables before any module reads process.env at top level
process.env.QR_SIGNING_PRIVATE_KEY = "test-hmac-secret-key-for-qr-signing-32";
process.env.JWT_SECRET = "test-jwt-secret-key-32-chars-minimum!!";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.STARKNET_RPC_URL = "http://localhost:5050";
process.env.DEPLOYER_PRIVATE_KEY = "0x1234567890abcdef";
process.env.DEPLOYER_ADDRESS = "0xdeadbeef";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";
