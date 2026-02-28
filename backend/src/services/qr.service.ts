import crypto from "node:crypto";
import QRCode from "qrcode";

const QR_SIGNING_PRIVATE_KEY = process.env.QR_SIGNING_PRIVATE_KEY!;

export interface QRPayload {
  ticket_id: string;
  timestamp: number;
  signature: string;
}

export function generateQRPayload(ticketId: string): QRPayload {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${ticketId}:${timestamp}`;
  const signature = crypto
    .createHmac("sha256", QR_SIGNING_PRIVATE_KEY)
    .update(message)
    .digest("hex");

  return { ticket_id: ticketId, timestamp, signature };
}

export function verifyQRSignature(
  ticketId: string,
  timestamp: number,
  signature: string
): boolean {
  const message = `${ticketId}:${timestamp}`;
  const expectedSignature = crypto
    .createHmac("sha256", QR_SIGNING_PRIVATE_KEY)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSignature, "hex")
  );
}

export function isTimestampValid(timestamp: number, windowSeconds = 30): boolean {
  const now = Math.floor(Date.now() / 1000);
  // SECURITY FIX (MED-09): Check both bounds — reject future timestamps too
  return Math.abs(now - timestamp) <= windowSeconds;
}

export async function generateQRDataUrl(ticketId: string): Promise<string> {
  const payload = generateQRPayload(ticketId);
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  return QRCode.toDataURL(encoded, { errorCorrectionLevel: "M", width: 300 });
}
