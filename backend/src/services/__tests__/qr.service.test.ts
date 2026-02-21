import { describe, it, expect, vi } from "vitest";
import {
  generateQRPayload,
  verifyQRSignature,
  isTimestampValid,
  generateQRDataUrl,
} from "../qr.service";

describe("generateQRPayload", () => {
  it("returns object with ticket_id, timestamp, and signature", () => {
    const payload = generateQRPayload("abc-123");
    expect(payload).toHaveProperty("ticket_id", "abc-123");
    expect(payload).toHaveProperty("timestamp");
    expect(payload).toHaveProperty("signature");
  });

  it("signature is a 64-char hex string (SHA-256)", () => {
    const payload = generateQRPayload("abc-123");
    expect(payload.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("timestamp is current epoch seconds within 2s tolerance", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = generateQRPayload("abc-123");
    expect(Math.abs(payload.timestamp - now)).toBeLessThanOrEqual(2);
  });

  it("different ticketIds produce different signatures", () => {
    const a = generateQRPayload("ticket-a");
    const b = generateQRPayload("ticket-b");
    expect(a.signature).not.toBe(b.signature);
  });
});

describe("verifyQRSignature", () => {
  it("returns true for a valid signature from generateQRPayload", () => {
    const payload = generateQRPayload("test-id");
    expect(
      verifyQRSignature(payload.ticket_id, payload.timestamp, payload.signature)
    ).toBe(true);
  });

  it("returns false for a tampered ticket_id", () => {
    const payload = generateQRPayload("test-id");
    expect(
      verifyQRSignature("tampered-id", payload.timestamp, payload.signature)
    ).toBe(false);
  });

  it("returns false for a tampered timestamp", () => {
    const payload = generateQRPayload("test-id");
    expect(
      verifyQRSignature(payload.ticket_id, payload.timestamp + 1, payload.signature)
    ).toBe(false);
  });

  it("returns false for a completely wrong signature", () => {
    const payload = generateQRPayload("test-id");
    const wrongSig = "a".repeat(64);
    expect(
      verifyQRSignature(payload.ticket_id, payload.timestamp, wrongSig)
    ).toBe(false);
  });

  it("throws on non-hex signature (buffer length mismatch)", () => {
    const payload = generateQRPayload("test-id");
    expect(() =>
      verifyQRSignature(payload.ticket_id, payload.timestamp, "not-hex")
    ).toThrow();
  });
});

describe("isTimestampValid", () => {
  it("returns true for a timestamp within the 30s window", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTimestampValid(now)).toBe(true);
    expect(isTimestampValid(now - 10)).toBe(true);
    expect(isTimestampValid(now - 30)).toBe(true);
  });

  it("returns false for a timestamp older than 30 seconds", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTimestampValid(now - 31)).toBe(false);
    expect(isTimestampValid(now - 60)).toBe(false);
  });

  it("respects custom windowSeconds parameter", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTimestampValid(now - 5, 10)).toBe(true);
    expect(isTimestampValid(now - 15, 10)).toBe(false);
  });
});

describe("generateQRDataUrl", () => {
  it("returns a data URL string", async () => {
    const dataUrl = await generateQRDataUrl("test-id");
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
