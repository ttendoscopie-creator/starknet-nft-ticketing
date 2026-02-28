import jwt from "jsonwebtoken";
import type { JWTPayload } from "../api/middleware/auth";

const JWT_SECRET = "test-jwt-secret-key-32-chars-minimum!!";

export function makeToken(overrides: Partial<JWTPayload> = {}): string {
  const payload: JWTPayload = {
    userId: "user-1",
    walletAddress: "0xabc123",
    email: "test@example.com",
    role: "fan",
    ...overrides,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

export function makeOrganizerToken(): string {
  return makeToken({ role: "organizer", userId: "org-1" });
}

export function makeStaffToken(): string {
  return makeToken({ role: "staff", userId: "staff-1" });
}

export function makeExpiredToken(): string {
  return jwt.sign(
    { userId: "user-1", walletAddress: "0xabc123", email: "test@example.com", role: "fan" as const },
    JWT_SECRET,
    { expiresIn: "-1s" }
  );
}
