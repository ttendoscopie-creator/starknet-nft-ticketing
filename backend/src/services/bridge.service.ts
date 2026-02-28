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

  const provided = signature.slice("sha256=".length);

  // SECURITY FIX (MED-05): Validate hex format before Buffer.from to prevent RangeError
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;

  const expected = crypto
    .createHmac("sha256", apiKey)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(provided, "hex")
  );
}
