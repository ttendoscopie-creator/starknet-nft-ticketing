import { describe, it, expect, vi } from "vitest";
import {
  authMiddleware,
  organizerOnly,
  staffOnly,
  generateToken,
  JWTPayload,
} from "../auth";
import {
  makeToken,
  makeOrganizerToken,
  makeStaffToken,
  makeExpiredToken,
} from "../../../__tests__/helpers";

function mockRequest(headers: Record<string, string> = {}, user?: JWTPayload) {
  return { headers, user } as any;
}

function mockReply() {
  const reply: any = {};
  reply.code = vi.fn(() => reply);
  reply.send = vi.fn(() => reply);
  return reply;
}

describe("authMiddleware", () => {
  it("attaches decoded user to request when valid Bearer token", async () => {
    const token = makeToken({ userId: "u1", walletAddress: "0x999", role: "fan" });
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const rep = mockReply();

    await authMiddleware(req, rep);

    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe("u1");
    expect(req.user.walletAddress).toBe("0x999");
    expect(req.user.role).toBe("fan");
    expect(rep.code).not.toHaveBeenCalled();
  });

  it("returns 401 when authorization header is missing", async () => {
    const req = mockRequest({});
    const rep = mockReply();

    await authMiddleware(req, rep);

    expect(rep.code).toHaveBeenCalledWith(401);
    expect(rep.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it("returns 401 when authorization header has no Bearer prefix", async () => {
    const req = mockRequest({ authorization: "Basic abc123" });
    const rep = mockReply();

    await authMiddleware(req, rep);

    expect(rep.code).toHaveBeenCalledWith(401);
  });

  it("returns 401 when token is expired", async () => {
    const token = makeExpiredToken();
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const rep = mockReply();

    await authMiddleware(req, rep);

    expect(rep.code).toHaveBeenCalledWith(401);
  });

  it("returns 401 when token is signed with wrong secret", async () => {
    const jwt = await import("jsonwebtoken");
    const badToken = jwt.default.sign({ userId: "u1", walletAddress: "0x1", role: "fan" }, "wrong-secret");
    const req = mockRequest({ authorization: `Bearer ${badToken}` });
    const rep = mockReply();

    await authMiddleware(req, rep);

    expect(rep.code).toHaveBeenCalledWith(401);
  });

  it("returns 401 when token is malformed", async () => {
    const req = mockRequest({ authorization: "Bearer not.a.valid.jwt" });
    const rep = mockReply();

    await authMiddleware(req, rep);

    expect(rep.code).toHaveBeenCalledWith(401);
  });
});

describe("organizerOnly", () => {
  it("allows request when user.role is organizer", async () => {
    const req = mockRequest({}, { userId: "o1", walletAddress: "0x1", role: "organizer" });
    const rep = mockReply();

    await organizerOnly(req, rep);

    expect(rep.code).not.toHaveBeenCalled();
  });

  it("returns 403 when user.role is fan", async () => {
    const req = mockRequest({}, { userId: "u1", walletAddress: "0x1", role: "fan" });
    const rep = mockReply();

    await organizerOnly(req, rep);

    expect(rep.code).toHaveBeenCalledWith(403);
  });

  it("returns 403 when user.role is staff", async () => {
    const req = mockRequest({}, { userId: "s1", walletAddress: "0x1", role: "staff" });
    const rep = mockReply();

    await organizerOnly(req, rep);

    expect(rep.code).toHaveBeenCalledWith(403);
  });

  it("returns 403 when user is undefined", async () => {
    const req = mockRequest({});
    const rep = mockReply();

    await organizerOnly(req, rep);

    expect(rep.code).toHaveBeenCalledWith(403);
  });
});

describe("staffOnly", () => {
  it("allows request when user.role is staff", async () => {
    const req = mockRequest({}, { userId: "s1", walletAddress: "0x1", role: "staff" });
    const rep = mockReply();

    await staffOnly(req, rep);

    expect(rep.code).not.toHaveBeenCalled();
  });

  it("allows request when user.role is organizer", async () => {
    const req = mockRequest({}, { userId: "o1", walletAddress: "0x1", role: "organizer" });
    const rep = mockReply();

    await staffOnly(req, rep);

    expect(rep.code).not.toHaveBeenCalled();
  });

  it("returns 403 when user.role is fan", async () => {
    const req = mockRequest({}, { userId: "u1", walletAddress: "0x1", role: "fan" });
    const rep = mockReply();

    await staffOnly(req, rep);

    expect(rep.code).toHaveBeenCalledWith(403);
  });

  it("returns 403 when user is undefined", async () => {
    const req = mockRequest({});
    const rep = mockReply();

    await staffOnly(req, rep);

    expect(rep.code).toHaveBeenCalledWith(403);
  });
});

describe("generateToken", () => {
  it("returns a valid JWT that can be decoded back to the payload", () => {
    const payload: JWTPayload = {
      userId: "u1",
      walletAddress: "0xabc",
      role: "fan",
    };
    const token = generateToken(payload);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    // Verify it can be used with authMiddleware
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, "test-jwt-secret-key-32-chars-minimum!!");
    expect(decoded.userId).toBe("u1");
    expect(decoded.walletAddress).toBe("0xabc");
    expect(decoded.role).toBe("fan");
  });
});
