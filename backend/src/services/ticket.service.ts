import { TicketStatus } from "@prisma/client";
import { prisma } from "../db/prisma";

export async function createTicket(params: {
  eventId: string;
  tokenId: bigint;
  ownerAddress: string;
  ownerEmail?: string;
}) {
  return prisma.ticket.create({
    data: {
      eventId: params.eventId,
      tokenId: params.tokenId,
      ownerAddress: params.ownerAddress,
      ownerEmail: params.ownerEmail,
    },
  });
}

export async function getTicketById(ticketId: string) {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { event: true },
  });
}

export async function getTicketByTokenId(eventId: string, tokenId: bigint) {
  return prisma.ticket.findUnique({
    where: { eventId_tokenId: { eventId, tokenId } },
    include: { event: true },
  });
}

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
  txHash?: string
) {
  return prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status,
      lastTransactionHash: txHash,
    },
  });
}

export async function getTicketsByOwner(ownerAddress: string) {
  return prisma.ticket.findMany({
    where: { ownerAddress },
    include: { event: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getTicketsByEvent(eventId: string) {
  return prisma.ticket.findMany({
    where: { eventId },
    orderBy: { tokenId: "asc" },
  });
}

export async function logScan(params: {
  ticketId: string;
  scannerStaffId?: string;
  gateId?: string;
  isOfflineValidation?: boolean;
}) {
  return prisma.scanLog.create({
    data: {
      ticketId: params.ticketId,
      scannerStaffId: params.scannerStaffId,
      gateId: params.gateId,
      isOfflineValidation: params.isOfflineValidation ?? false,
    },
  });
}

export async function revokeTicket(ticketId: string, txHash?: string) {
  return prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: "REVOKED",
        ownerAddress: "0x0",
        lastTransactionHash: txHash,
      },
    }),
    prisma.listing.updateMany({
      where: { ticketId, isActive: true },
      data: { isActive: false },
    }),
  ]);
}

