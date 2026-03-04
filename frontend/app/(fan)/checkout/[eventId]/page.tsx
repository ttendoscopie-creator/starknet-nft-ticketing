"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { RpcProvider, CallData } from "starknet";
import { useAuth } from "../../../auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const USDC_ADDRESS =
  "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080";
const RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_RPC ||
  "https://starknet-sepolia.public.blastapi.io";

type PaymentMethod = "select" | "crypto" | "stripe";
type CheckoutState = "idle" | "sending" | "confirming" | "verifying" | "success" | "error";

interface EventData {
  id: string;
  name: string;
  eventDate: string;
  primaryPrice: number;
  maxSupply: number;
  acceptedCurrencies: string[];
  organizer: { name: string; treasuryAddress: string };
  _count: { tickets: number };
}

export default function CheckoutPage() {
  const params = useParams();
  const eventId = params.eventId as string;
  const { connected, walletAddress, token, login, getAccount } = useAuth();

  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("select");
  const [state, setState] = useState<CheckoutState>("idle");
  const [stripeLoading, setStripeLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Fetch event details
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/events/${eventId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Event not found (${res.status})`);
        const data: EventData = await res.json();
        setEvent(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFetchError(err instanceof Error ? err.message : "Failed to load event");
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [eventId, token]);

  const formatUSDC = (amount: number) => {
    return (amount / 1_000_000).toFixed(2);
  };

  const handlePay = useCallback(async () => {
    if (!event || !walletAddress || !token) return;

    const account = getAccount() as {
      execute: (calls: unknown[]) => Promise<{ transaction_hash: string }>;
    } | null;
    if (!account) {
      setErrorMsg("Wallet account not available. Please reconnect.");
      setState("error");
      return;
    }

    const treasuryAddress = event.organizer.treasuryAddress;
    if (!treasuryAddress) {
      setErrorMsg("Event organizer has no treasury address configured.");
      setState("error");
      return;
    }

    try {
      // Step 1: Send ERC20 transfer
      setState("sending");
      setErrorMsg(null);

      const calldata = CallData.compile({
        recipient: treasuryAddress,
        amount: { low: event.primaryPrice, high: "0" },
      });

      const result = await account.execute([
        {
          contractAddress: USDC_ADDRESS,
          entrypoint: "transfer",
          calldata,
        },
      ]);

      const hash = result.transaction_hash;
      setTxHash(hash);

      // Step 2: Wait for on-chain confirmation
      setState("confirming");
      const provider = new RpcProvider({ nodeUrl: RPC_URL });
      await provider.waitForTransaction(hash);

      // Step 3: Verify with backend
      setState("verifying");
      const verifyRes = await fetch(`${API_URL}/v1/payments/verify-crypto`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventId,
          txHash: hash,
          buyerWalletAddress: walletAddress,
          currency: "USDC",
        }),
      });

      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body.error || `Verification failed (${verifyRes.status})`);
      }

      setState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Payment failed");
      setState("error");
    }
  }, [event, walletAddress, token, getAccount, eventId]);

  const handleStripe = useCallback(async () => {
    if (!event || !token) return;
    setStripeLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_URL}/v1/payments/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventId,
          buyerWalletAddress: walletAddress || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to create checkout session (${res.status})`);
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Payment failed");
      setStripeLoading(false);
    }
  }, [event, token, eventId, walletAddress]);

  if (loading) {
    return (
      <div className="mx-auto max-w-lg py-12">
        <div className="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
      </div>
    );
  }

  if (fetchError || !event) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          Event not found
        </h1>
        <p className="text-red-600 dark:text-red-400">{fetchError}</p>
      </div>
    );
  }

  const remaining = event.maxSupply - event._count.tickets;
  const soldOut = remaining <= 0;
  const acceptsUSDC = event.acceptedCurrencies.includes("USDC");

  return (
    <div className="mx-auto max-w-lg py-12">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {event.name}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">
          By {event.organizer.name}
        </p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
          {new Date(event.eventDate).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>

        <div className="flex items-baseline justify-between border-t border-gray-100 dark:border-gray-700 pt-4 mb-4">
          <span className="text-3xl font-bold text-gray-900 dark:text-white">
            {formatUSDC(event.primaryPrice)} USDC
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {remaining} / {event.maxSupply} remaining
          </span>
        </div>

        {!acceptsUSDC && (
          <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-4 text-yellow-700 dark:text-yellow-400 text-sm mb-4">
            This event does not accept USDC payments.
          </div>
        )}

        {soldOut && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-red-600 dark:text-red-400 text-sm mb-4">
            This event is sold out.
          </div>
        )}

        {state === "success" ? (
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-6 text-center">
            <p className="text-green-700 dark:text-green-400 font-semibold text-lg mb-2">
              Payment successful!
            </p>
            <p className="text-green-600 dark:text-green-500 text-sm mb-4">
              Your NFT ticket is being minted.
            </p>
            <a
              href="/tickets"
              className="inline-block rounded-lg bg-primary px-6 py-2 text-white font-medium hover:bg-indigo-600 transition"
            >
              View my tickets
            </a>
          </div>
        ) : state === "error" || errorMsg ? (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 mb-4">
            <p className="text-red-600 dark:text-red-400 text-sm mb-3">{errorMsg}</p>
            <button
              onClick={() => { setState("idle"); setErrorMsg(null); setPaymentMethod("select"); }}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30 transition"
            >
              Try again
            </button>
          </div>
        ) : !connected ? (
          <button
            onClick={login}
            className="w-full rounded-lg bg-primary px-6 py-3 text-white font-medium hover:bg-indigo-600 transition"
          >
            Connect wallet
          </button>
        ) : paymentMethod === "select" ? (
          <div className="space-y-3">
            <button
              onClick={() => { handleStripe(); }}
              disabled={soldOut || stripeLoading}
              className="w-full rounded-lg bg-primary px-6 py-3 text-white font-medium hover:bg-indigo-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {stripeLoading ? "Redirecting..." : "Pay by card"}
            </button>
            {acceptsUSDC && (
              <button
                onClick={() => setPaymentMethod("crypto")}
                disabled={soldOut}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-6 py-3 text-gray-900 dark:text-white font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Pay with crypto (USDC)
              </button>
            )}
          </div>
        ) : (
          <div>
            <button
              onClick={() => setPaymentMethod("select")}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-3"
            >
              &larr; Back
            </button>
            <button
              onClick={handlePay}
              disabled={soldOut || !acceptsUSDC || state !== "idle"}
              className="w-full rounded-lg bg-primary px-6 py-3 text-white font-medium hover:bg-indigo-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state === "sending" && "Sending transaction..."}
              {state === "confirming" && "Waiting for confirmation..."}
              {state === "verifying" && "Verifying payment..."}
              {state === "idle" && `Pay ${formatUSDC(event.primaryPrice)} USDC`}
            </button>
          </div>
        )}

        {txHash && state !== "success" && state !== "idle" && (
          <p className="mt-3 text-xs text-gray-400 text-center font-mono break-all">
            Tx: {txHash}
          </p>
        )}
      </div>
    </div>
  );
}
