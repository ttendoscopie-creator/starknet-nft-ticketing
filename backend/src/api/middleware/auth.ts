import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface JWTPayload {
  userId: string;
  walletAddress: string;
  role: "fan" | "organizer" | "staff";
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    (request as FastifyRequest & { user: JWTPayload }).user = decoded;
  } catch {
    reply.code(401).send({ error: "Invalid or expired token" });
  }
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export async function organizerOnly(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = (request as FastifyRequest & { user?: JWTPayload }).user;
  if (!user || user.role !== "organizer") {
    reply.code(403).send({ error: "Organizer access required" });
  }
}

export async function staffOnly(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = (request as FastifyRequest & { user?: JWTPayload }).user;
  if (!user || (user.role !== "staff" && user.role !== "organizer")) {
    reply.code(403).send({ error: "Staff access required" });
  }
}
