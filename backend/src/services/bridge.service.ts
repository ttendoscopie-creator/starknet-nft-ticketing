import crypto from "node:crypto";

/**
 * Verify HMAC-SHA256 signature from an external webhook provider.
 * Uses the organizer's apiKey as the HMAC secret.
 *
 * Expected header format: "sha256=<hex_digest>"
 */
export function verifyBridgeSignature(
  rawBody: Buffer,
  signature: string,
  apiKey: string
): boolean {
  if (!signature.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", apiKey)
    .update(rawBody)
    .digest("hex");

  const provided = signature.slice("sha256=".length);

  if (expected.length !== provided.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(provided, "hex")
  );
}
