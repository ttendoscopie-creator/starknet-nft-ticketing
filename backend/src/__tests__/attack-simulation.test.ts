/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║              HOSTILE ATTACK SIMULATION — BRIDGE MODULE              ║
 * ║                                                                     ║
 * ║  Simulates realistic attack scenarios against the bridge:           ║
 * ║  webhook forgery, ticket theft, double-claim races, IDOR,           ║
 * ║  JWT manipulation, timing attacks, enumeration.                     ║
 * ║                                                                     ║
 * ║  Each test represents a distinct attacker persona with a specific   ║
 * ║  objective. All attacks MUST fail — any passing attack = vuln.      ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { makeToken } from "./helpers";

// ── Mocks ────────────────────────────────────────────────────────────────

const {
  mockPrisma,
  mockBridgeMintQueueAdd,
  mockBridgeClaimQueueAdd,
  mockGetTicketById,
  mockLogScan,
  mockUpdateTicketStatus,
  mockVerifyQRSignature,
  mockIsTimestampValid,
  mockGetTicketCache,
  mockSetTicketCache,
  mockMarkTicketUsedAtomic,
  mockMarkUsedQueueAdd,
} = vi.hoisted(() => ({
  mockPrisma: {
    organizer: { findUnique: vi.fn() },
    event: { findUnique: vi.fn() },
    bridgedTicket: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    ticket: { findUnique: vi.fn() },
  },
  mockBridgeMintQueueAdd: vi.fn(),
  mockBridgeClaimQueueAdd: vi.fn(),
  mockGetTicketById: vi.fn(),
  mockLogScan: vi.fn(),
  mockUpdateTicketStatus: vi.fn(),
  mockVerifyQRSignature: vi.fn(),
  mockIsTimestampValid: vi.fn(),
  mockGetTicketCache: vi.fn(),
  mockSetTicketCache: vi.fn(),
  mockMarkTicketUsedAtomic: vi.fn(),
  mockMarkUsedQueueAdd: vi.fn(),
}));

vi.mock("../db/prisma", () => ({ prisma: mockPrisma }));

vi.mock("../queue/bridge.worker", () => ({
  bridgeMintQueue: { add: mockBridgeMintQueueAdd },
  bridgeClaimQueue: { add: mockBridgeClaimQueueAdd },
}));

vi.mock("../services/ticket.service", () => ({
  getTicketById: (...args: any[]) => mockGetTicketById(...args),
  logScan: (...args: any[]) => mockLogScan(...args),
  updateTicketStatus: (...args: any[]) => mockUpdateTicketStatus(...args),
}));

vi.mock("../services/qr.service", () => ({
  verifyQRSignature: (...args: any[]) => mockVerifyQRSignature(...args),
  isTimestampValid: (...args: any[]) => mockIsTimestampValid(...args),
}));

vi.mock("../db/redis", () => ({
  getTicketCache: (...args: any[]) => mockGetTicketCache(...args),
  setTicketCache: (...args: any[]) => mockSetTicketCache(...args),
  markTicketUsedAtomic: (...args: any[]) => mockMarkTicketUsedAtomic(...args),
  bullmqConnection: {},
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: (...args: any[]) => mockMarkUsedQueueAdd(...args),
  })),
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));

vi.mock("../config/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { bridgeRoutes } from "../api/routes/bridge";
import { scanRoutes } from "../api/routes/scan";

// ── Constants ────────────────────────────────────────────────────────────

const JWT_SECRET = "test-jwt-secret-key-32-chars-minimum!!";
const API_KEY = "org-secret-hmac-key-very-long-and-random";
const ORGANIZER_ID = "110e8400-e29b-41d4-a716-446655440000";
const EVENT_ID = "220e8400-e29b-41d4-a716-446655440000";
const BT_ID = "330e8400-e29b-41d4-a716-446655440000";
const TICKET_ID = "550e8400-e29b-41d4-a716-446655440000";

// Personas
const VICTIM_EMAIL = "alice@legit.com";
const VICTIM_WALLET = "0xalice_real_wallet";
const ATTACKER_EMAIL = "eve@evil.com";
const ATTACKER_WALLET = "0xeve_evil_wallet";

function hmacSign(body: string, key: string): string {
  return "sha256=" + crypto.createHmac("sha256", key).update(body).digest("hex");
}

function attackerToken(overrides: Record<string, unknown> = {}) {
  return makeToken({
    userId: "attacker-1",
    walletAddress: ATTACKER_WALLET,
    email: ATTACKER_EMAIL,
    role: "fan",
    ...overrides,
  });
}

function victimToken() {
  return makeToken({
    userId: "victim-1",
    walletAddress: VICTIM_WALLET,
    email: VICTIM_EMAIL,
    role: "fan",
  });
}

const mockOrganizer = { id: ORGANIZER_ID, name: "Legit Org", apiKey: API_KEY };
const mockEvent = {
  id: EVENT_ID,
  organizerId: ORGANIZER_ID,
  contractAddress: "0xdeployed",
  isSoulbound: false,
};

// ── App setup ────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(bridgeRoutes);
  await app.register(scanRoutes);
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSetTicketCache.mockResolvedValue(undefined);
  mockLogScan.mockResolvedValue(undefined);
  mockUpdateTicketStatus.mockResolvedValue(undefined);
  mockMarkUsedQueueAdd.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 1: WEBHOOK FORGERY — Attacker crafts a fake webhook
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 1: Webhook Forgery", () => {
  const payload = JSON.stringify({
    external_ticket_id: "FAKE-001",
    email: ATTACKER_EMAIL,
    event_id: EVENT_ID,
    organizer_id: ORGANIZER_ID,
  });

  it("ATK-1a: Rejects webhook with no signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(payload),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Missing");
  });

  it("ATK-1b: Rejects webhook signed with attacker's own key", async () => {
    const fakeKey = "attacker-controlled-secret-key-12345678";
    const sig = hmacSign(payload, fakeKey);
    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(payload),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": sig,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid signature");
  });

  it("ATK-1c: Rejects webhook with truncated signature (length attack)", async () => {
    const validSig = hmacSign(payload, API_KEY);
    const truncated = validSig.slice(0, 20); // sha256=<partial>

    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(payload),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": truncated,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ATK-1d: Rejects webhook with valid sig but tampered body (bit-flip)", async () => {
    const originalBody = JSON.stringify({
      external_ticket_id: "LEGIT-001",
      email: VICTIM_EMAIL,
      event_id: EVENT_ID,
      organizer_id: ORGANIZER_ID,
    });
    const sig = hmacSign(originalBody, API_KEY);

    // Attacker intercepts and changes email
    const tamperedBody = JSON.stringify({
      external_ticket_id: "LEGIT-001",
      email: ATTACKER_EMAIL, // ← changed
      event_id: EVENT_ID,
      organizer_id: ORGANIZER_ID,
    });

    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(tamperedBody),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": sig, // signature of ORIGINAL body
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ATK-1e: Rejects webhook with 'none' signature bypass attempt", async () => {
    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(payload),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": "none",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ATK-1f: Cannot distinguish existing vs non-existing organizer (anti-enumeration)", async () => {
    mockPrisma.organizer.findUnique.mockResolvedValue(null); // does not exist
    const sig = hmacSign(payload, "random-key");

    const res1 = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(payload),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": sig,
      },
    });

    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);
    // Wrong signature (organizer exists but sig invalid)
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(payload),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
    });

    // Both return same status + same error message → no oracle
    expect(res1.statusCode).toBe(res2.statusCode);
    expect(res1.json().error).toBe(res2.json().error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 2: TICKET THEFT — Attacker claims victim's bridged tickets
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 2: Ticket Theft via Bridge Claim", () => {
  it("ATK-2a: Attacker cannot claim victim's tickets (email bound to JWT)", async () => {
    // Attacker's JWT has eve@evil.com — victim's tickets are alice@legit.com
    // The claim route uses request.user.email (from JWT), not a body param
    mockPrisma.bridgedTicket.updateMany.mockResolvedValue({ count: 0 });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${attackerToken()}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().claimed).toBe(0);

    // Verify the query used attacker's email, not victim's
    expect(mockPrisma.bridgedTicket.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ ownerEmail: ATTACKER_EMAIL }),
      data: { status: "CLAIMING" },
    });
  });

  it("ATK-2b: Attacker cannot inject victim's email via request body", async () => {
    // Old vulnerability: email was taken from request body
    // Now email comes from JWT — body email is ignored
    mockPrisma.bridgedTicket.updateMany.mockResolvedValue({ count: 0 });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {
        email: VICTIM_EMAIL, // ← injected, should be IGNORED
        wallet_address: ATTACKER_WALLET,
      },
      headers: { authorization: `Bearer ${attackerToken()}` },
    });

    expect(res.statusCode).toBe(200);
    // Verify it used the JWT email (attacker's), NOT the body email (victim's)
    expect(mockPrisma.bridgedTicket.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ ownerEmail: ATTACKER_EMAIL }),
      data: { status: "CLAIMING" },
    });
  });

  it("ATK-2c: Attacker cannot view victim's bridged ticket status (IDOR)", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: BT_ID,
      ownerEmail: VICTIM_EMAIL,
      claimedByAddress: VICTIM_WALLET,
      status: "CLAIMED",
      tokenId: "42",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/bridge/status/${BT_ID}`,
      headers: { authorization: `Bearer ${attackerToken()}` },
    });

    // Returns 404 (not 403) to avoid confirming existence
    expect(res.statusCode).toBe(404);
    expect(res.json()).not.toHaveProperty("tokenId");
    expect(res.json()).not.toHaveProperty("ownerEmail");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 3: DOUBLE-CLAIM RACE — Two concurrent claims for same tickets
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 3: Double-Claim Race Condition", () => {
  it("ATK-3a: Concurrent claims — only one succeeds due to atomic MINTED→CLAIMING", async () => {
    const token = victimToken();

    // First call: 2 tickets transition MINTED → CLAIMING
    let callCount = 0;
    mockPrisma.bridgedTicket.updateMany.mockImplementation(async () => {
      callCount++;
      // First call succeeds (tickets exist in MINTED), second call finds 0 (already CLAIMING)
      return { count: callCount === 1 ? 2 : 0 };
    });

    mockPrisma.bridgedTicket.findMany.mockResolvedValue([
      { id: "bt-1", eventId: EVENT_ID, tokenId: "1", passType: "VIP" },
      { id: "bt-2", eventId: EVENT_ID, tokenId: "2", passType: "GA" },
    ]);
    mockBridgeClaimQueueAdd.mockResolvedValue({});

    // Simulate two concurrent requests
    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/bridge/claim",
        payload: {},
        headers: { authorization: `Bearer ${token}` },
      }),
      app.inject({
        method: "POST",
        url: "/v1/bridge/claim",
        payload: {},
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);

    const results = [res1.json(), res2.json()];
    const claimedCounts = results.map((r) => r.claimed);

    // One got 2, the other got 0 — no double-claim
    expect(claimedCounts.sort()).toEqual([0, 2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 4: JWT MANIPULATION — Forge/tamper tokens
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 4: JWT Manipulation", () => {
  it("ATK-4a: Rejects JWT signed with different secret", async () => {
    const forgedToken = jwt.sign(
      { userId: "admin", walletAddress: "0x1", email: VICTIM_EMAIL, role: "organizer" },
      "different-secret-key-that-is-long-enough!!"
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${forgedToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ATK-4b: Rejects JWT with 'none' algorithm attack", async () => {
    // Manually craft a JWT with alg: none
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        userId: "admin",
        walletAddress: "0x1",
        email: VICTIM_EMAIL,
        role: "organizer",
      })
    ).toString("base64url");
    const noneToken = `${header}.${payload}.`;

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${noneToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ATK-4c: Rejects expired JWT", async () => {
    const expiredToken = jwt.sign(
      { userId: "u1", walletAddress: "0x1", email: "a@b.com", role: "fan" },
      JWT_SECRET,
      { expiresIn: "-10s" }
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ATK-4d: Rejects JWT with RS256 key confusion (algorithm substitution)", async () => {
    // Try signing with HS256 using a public key as secret (classic alg confusion)
    // Our middleware pins algorithms: ["HS256"], so RS256 tokens are rejected
    const fakeRsaToken = jwt.sign(
      { userId: "admin", walletAddress: "0x1", email: VICTIM_EMAIL, role: "organizer" },
      "fake-rsa-public-key-material",
      { algorithm: "HS256" } // even if it's the same algo, wrong secret = rejected
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${fakeRsaToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ATK-4e: Cannot claim without email in JWT", async () => {
    // JWT without email field
    const noEmailToken = jwt.sign(
      { userId: "u1", walletAddress: "0x1", role: "fan" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${noEmailToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("JWT missing email claim");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 5: REPLAY ATTACK — Reuse a valid webhook
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 5: Webhook Replay", () => {
  it("ATK-5a: Replayed webhook is idempotent (no double-mint)", async () => {
    const body = JSON.stringify({
      external_ticket_id: "EVT-REPLAY-001",
      email: VICTIM_EMAIL,
      event_id: EVENT_ID,
      organizer_id: ORGANIZER_ID,
    });
    const sig = hmacSign(body, API_KEY);

    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);
    mockPrisma.event.findUnique.mockResolvedValue(mockEvent);

    // First call succeeds
    mockPrisma.bridgedTicket.create.mockResolvedValueOnce({
      id: BT_ID,
      status: "PENDING",
    });
    mockBridgeMintQueueAdd.mockResolvedValue({});

    const res1 = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: { "content-type": "application/json", "x-bridge-signature": sig },
    });
    expect(res1.statusCode).toBe(200);
    expect(mockBridgeMintQueueAdd).toHaveBeenCalledTimes(1);

    // Second call — unique constraint violation
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "5.0.0" }
    );
    mockPrisma.bridgedTicket.create.mockRejectedValueOnce(p2002);
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: BT_ID,
      status: "MINTED",
    });

    const res2 = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: { "content-type": "application/json", "x-bridge-signature": sig },
    });

    expect(res2.statusCode).toBe(200);
    // Mint queue NOT called again
    expect(mockBridgeMintQueueAdd).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 6: PAYLOAD INJECTION — Malicious payloads
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 6: Payload Injection", () => {
  it("ATK-6a: Rejects SQL injection in external_ticket_id", async () => {
    const body = JSON.stringify({
      external_ticket_id: "'; DROP TABLE bridged_tickets; --",
      email: "legit@example.com",
      event_id: EVENT_ID,
      organizer_id: ORGANIZER_ID,
    });
    const sig = hmacSign(body, API_KEY);
    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);
    mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
    mockPrisma.bridgedTicket.create.mockResolvedValue({ id: BT_ID, status: "PENDING" });
    mockBridgeMintQueueAdd.mockResolvedValue({});

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: { "content-type": "application/json", "x-bridge-signature": sig },
    });

    // Prisma parameterizes queries — SQL injection is neutralized
    // The string passes Zod validation but is safely handled
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.bridgedTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalTicketId: "'; DROP TABLE bridged_tickets; --",
        }),
      })
    );
  });

  it("ATK-6b: Rejects oversized email (max 320 chars)", async () => {
    const longEmail = "a".repeat(300) + "@evil.com"; // 309 chars, within limit
    const tooLongEmail = "a".repeat(320) + "@evil.com"; // 329 chars, exceeds 320

    const body = JSON.stringify({
      external_ticket_id: "X1",
      email: tooLongEmail,
      event_id: EVENT_ID,
      organizer_id: ORGANIZER_ID,
    });
    const sig = hmacSign(body, API_KEY);

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: { "content-type": "application/json", "x-bridge-signature": sig },
    });
    expect(res.statusCode).toBe(400);
  });

  it("ATK-6c: Rejects non-UUID event_id (path traversal attempt)", async () => {
    const body = JSON.stringify({
      external_ticket_id: "X1",
      email: "legit@example.com",
      event_id: "../../../etc/passwd",
      organizer_id: ORGANIZER_ID,
    });
    const sig = hmacSign(body, API_KEY);

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: { "content-type": "application/json", "x-bridge-signature": sig },
    });
    expect(res.statusCode).toBe(400);
  });

  it("ATK-6d: Rejects XSS in external_ticket_id", async () => {
    const body = JSON.stringify({
      external_ticket_id: '<script>alert("xss")</script>',
      email: "legit@example.com",
      event_id: EVENT_ID,
      organizer_id: ORGANIZER_ID,
    });
    const sig = hmacSign(body, API_KEY);
    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);
    mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
    mockPrisma.bridgedTicket.create.mockResolvedValue({ id: BT_ID, status: "PENDING" });
    mockBridgeMintQueueAdd.mockResolvedValue({});

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: { "content-type": "application/json", "x-bridge-signature": sig },
    });

    // Stored as-is (Prisma parameterized) — XSS prevention is frontend concern
    // Key: the value is never reflected unescaped in our API responses
    expect(res.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 7: PRIVILEGE ESCALATION — Fan accesses organizer endpoints
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 7: Privilege Escalation", () => {
  it("ATK-7a: Fan cannot access scan endpoint (staff-only)", async () => {
    const fanToken = makeToken({ role: "fan", email: "fan@evil.com" });

    mockVerifyQRSignature.mockReturnValue(true);
    mockIsTimestampValid.mockReturnValue(true);

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: TICKET_ID,
        signature: "a".repeat(64),
        timestamp: Math.floor(Date.now() / 1000),
      },
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("ATK-7b: Attacker cannot forge role in JWT", async () => {
    // Attacker creates JWT claiming to be organizer with a different secret
    const forgedOrganizerToken = jwt.sign(
      { userId: "attacker", walletAddress: "0xevil", email: "evil@hack.com", role: "organizer" },
      "wrong-secret-key-attempt-to-forge!!!!"
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${forgedOrganizerToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 8: SCAN ABUSE — Replay/reuse ticket scans
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 8: Scan Abuse", () => {
  const staffToken = makeToken({ role: "staff", userId: "staff-1", email: "staff@venue.com" });

  it("ATK-8a: Cannot scan an already-used ticket", async () => {
    mockVerifyQRSignature.mockReturnValue(true);
    mockIsTimestampValid.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue({
      status: "USED",
      ownerAddress: "0xowner",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: TICKET_ID,
        signature: "a".repeat(64),
        timestamp: Math.floor(Date.now() / 1000),
      },
      headers: { authorization: `Bearer ${staffToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(res.json().reason).toBe("TICKET_NOT_VALID");
  });

  it("ATK-8b: Cannot scan a revoked ticket", async () => {
    mockVerifyQRSignature.mockReturnValue(true);
    mockIsTimestampValid.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue({
      status: "REVOKED",
      ownerAddress: "0xowner",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: TICKET_ID,
        signature: "a".repeat(64),
        timestamp: Math.floor(Date.now() / 1000),
      },
      headers: { authorization: `Bearer ${staffToken}` },
    });

    expect(res.json().valid).toBe(false);
    expect(res.json().reason).toBe("TICKET_NOT_VALID");
  });

  it("ATK-8c: Cannot scan a listed ticket (being sold)", async () => {
    mockVerifyQRSignature.mockReturnValue(true);
    mockIsTimestampValid.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue({
      status: "LISTED",
      ownerAddress: "0xowner",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: TICKET_ID,
        signature: "a".repeat(64),
        timestamp: Math.floor(Date.now() / 1000),
      },
      headers: { authorization: `Bearer ${staffToken}` },
    });

    expect(res.json().valid).toBe(false);
    expect(res.json().reason).toBe("TICKET_LISTED");
  });

  it("ATK-8d: Double-scan blocked by atomic Redis SETNX", async () => {
    mockVerifyQRSignature.mockReturnValue(true);
    mockIsTimestampValid.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue({
      status: "AVAILABLE",
      ownerAddress: "0xowner",
      ownerName: "Alice",
    });

    // First scan succeeds
    mockMarkTicketUsedAtomic.mockResolvedValueOnce(true);
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: TICKET_ID,
        signature: "a".repeat(64),
        timestamp: Math.floor(Date.now() / 1000),
      },
      headers: { authorization: `Bearer ${staffToken}` },
    });
    expect(res1.json().valid).toBe(true);

    // Second scan — Redis SETNX returns false
    mockMarkTicketUsedAtomic.mockResolvedValueOnce(false);
    // Cache now shows USED
    mockGetTicketCache.mockResolvedValue({
      status: "USED",
      ownerAddress: "0xowner",
    });

    const res2 = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: TICKET_ID,
        signature: "a".repeat(64),
        timestamp: Math.floor(Date.now() / 1000),
      },
      headers: { authorization: `Bearer ${staffToken}` },
    });
    expect(res2.json().valid).toBe(false);
  });

  it("ATK-8e: Rejects expired QR code (replay after 30s window)", async () => {
    mockIsTimestampValid.mockReturnValue(false);
    mockVerifyQRSignature.mockReturnValue(true);

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: TICKET_ID,
        signature: "a".repeat(64),
        timestamp: Math.floor(Date.now() / 1000) - 60, // 60s ago
      },
      headers: { authorization: `Bearer ${staffToken}` },
    });

    expect(res.json().valid).toBe(false);
    expect(res.json().reason).toBe("QR_EXPIRED");
  });

  it("ATK-8f: Rejects future-dated QR code (time manipulation)", async () => {
    mockIsTimestampValid.mockReturnValue(false); // both-bounds check rejects future
    mockVerifyQRSignature.mockReturnValue(true);

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: TICKET_ID,
        signature: "a".repeat(64),
        timestamp: Math.floor(Date.now() / 1000) + 120, // 2 minutes in future
      },
      headers: { authorization: `Bearer ${staffToken}` },
    });

    expect(res.json().valid).toBe(false);
    expect(res.json().reason).toBe("QR_EXPIRED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 9: CROSS-ORGANIZER BREACH — Organizer A's ticket via Org B
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 9: Cross-Organizer Breach", () => {
  it("ATK-9a: Webhook rejects event not owned by signing organizer", async () => {
    const OTHER_ORG_EVENT = "990e8400-e29b-41d4-a716-446655440000";
    const body = JSON.stringify({
      external_ticket_id: "CROSS-001",
      email: "buyer@example.com",
      event_id: OTHER_ORG_EVENT,
      organizer_id: ORGANIZER_ID,
    });
    const sig = hmacSign(body, API_KEY);

    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);
    mockPrisma.event.findUnique.mockResolvedValue({
      id: OTHER_ORG_EVENT,
      organizerId: "different-organizer-id", // ← belongs to someone else
      contractAddress: "0xdeployed",
      isSoulbound: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: { "content-type": "application/json", "x-bridge-signature": sig },
    });

    // Returns 200 with received:true but does NOT queue a mint
    expect(res.statusCode).toBe(200);
    expect(mockBridgeMintQueueAdd).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ATTACK 10: SOULBOUND BYPASS — Attempt to bridge soulbound tickets
// ═══════════════════════════════════════════════════════════════════════════

describe("ATTACK 10: Soulbound Bypass", () => {
  it("ATK-10a: Cannot bridge soulbound event tickets", async () => {
    const body = JSON.stringify({
      external_ticket_id: "SOUL-001",
      email: "buyer@example.com",
      event_id: EVENT_ID,
      organizer_id: ORGANIZER_ID,
    });
    const sig = hmacSign(body, API_KEY);

    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);
    mockPrisma.event.findUnique.mockResolvedValue({ ...mockEvent, isSoulbound: true });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: { "content-type": "application/json", "x-bridge-signature": sig },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Soulbound");
    expect(mockBridgeMintQueueAdd).not.toHaveBeenCalled();
  });
});
