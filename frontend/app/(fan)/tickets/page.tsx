"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../auth-context";
import TicketCard from "../../../components/TicketCard";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Ticket {
  id: string;
  tokenId: string;
  status: "AVAILABLE" | "LISTED" | "USED" | "CANCELLED";
  ownerAddress: string;
  event: {
    name: string;
    eventDate: string;
  };
}

export default function TicketsPage() {
  const { connected, walletAddress, token, login } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/v1/tickets`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) throw new Error(`Failed to fetch tickets (${res.status})`);
      const data: Ticket[] = await res.json();
      setTickets(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!connected || !token) return;
    const controller = new AbortController();
    fetchTickets(controller.signal);
    return () => controller.abort();
  }, [connected, token, fetchTickets]);

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          My Tickets
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Connect your wallet to view your NFT tickets.
        </p>
        <button
          onClick={login}
          className="rounded-lg bg-primary px-6 py-3 text-white font-medium hover:bg-indigo-600 transition"
        >
          Connect your wallet
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          My Tickets
        </h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          My Tickets
        </h1>
        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 p-8 text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={() => fetchTickets()}
            className="rounded-lg bg-primary px-4 py-2 text-white font-medium hover:bg-indigo-600 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        My Tickets
      </h1>
      {tickets.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
            <p className="text-gray-400">No tickets yet</p>
            <a
              href="/marketplace"
              className="mt-4 inline-block text-primary hover:underline"
            >
              Browse events
            </a>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              id={ticket.id}
              eventName={ticket.event.name}
              eventDate={ticket.event.eventDate}
              tokenId={ticket.tokenId}
              status={ticket.status}
              ownerAddress={ticket.ownerAddress}
            />
          ))}
        </div>
      )}
    </div>
  );
}
