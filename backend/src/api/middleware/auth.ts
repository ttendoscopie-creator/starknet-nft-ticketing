import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface JWTPayload {
  userId: string;
  walletAddress: string;
  email: string;
  role: "fan" | "organizer" | "staff";
}

declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JWTPayload;
    request.user = decoded;
  } catch {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h", algorithm: "HS256" });
}

export async function organizerOnly(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user || request.user.role !== "organizer") {
    return reply.code(403).send({ error: "Organizer access required" });
  }
}

export async function staffOnly(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user || (request.user.role !== "staff" && request.user.role !== "organizer")) {
    return reply.code(403).send({ error: "Staff access required" });
  }
}
