import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyBridgeSignature } from "../bridge.service";

const API_KEY = "test-api-key-for-hmac-verification";

function makeSignature(body: Buffer, key: string): string {
  const hmac = crypto.createHmac("sha256", key).update(body).digest("hex");
  return `sha256=${hmac}`;
}

describe("verifyBridgeSignature", () => {
  it("returns true for a valid HMAC signature", () => {
    const body = Buffer.from(JSON.stringify({ test: "data" }));
    const sig = makeSignature(body, API_KEY);

    expect(verifyBridgeSignature(body, sig, API_KEY)).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    const body = Buffer.from(JSON.stringify({ test: "data" }));
    const sig = makeSignature(body, "wrong-key");

    expect(verifyBridgeSignature(body, sig, API_KEY)).toBe(false);
  });

  it("returns false when signature prefix is missing", () => {
    const body = Buffer.from(JSON.stringify({ test: "data" }));
    const hmac = crypto.createHmac("sha256", API_KEY).update(body).digest("hex");

    expect(verifyBridgeSignature(body, hmac, API_KEY)).toBe(false);
  });

  it("returns false when signature hex length differs", () => {
    const body = Buffer.from(JSON.stringify({ test: "data" }));

    expect(verifyBridgeSignature(body, "sha256=abc", API_KEY)).toBe(false);
  });

  it("returns true for empty body with valid signature", () => {
    const body = Buffer.from("");
    const sig = makeSignature(body, API_KEY);

    expect(verifyBridgeSignature(body, sig, API_KEY)).toBe(true);
  });
});
