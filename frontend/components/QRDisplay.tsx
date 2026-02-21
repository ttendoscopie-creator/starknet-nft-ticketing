"use client";

import { useState, useEffect, useCallback } from "react";

interface QRPayload {
  ticket_id: string;
  timestamp: number;
  signature: string;
}

interface QRDisplayProps {
  ticketId: string;
  apiUrl: string;
  token: string;
}

const QR_REFRESH_INTERVAL = 25000; // 25s (expires at 30s server-side)
const COUNTDOWN_TOTAL = 30;

export default function QRDisplay({ ticketId, apiUrl, token }: QRDisplayProps) {
  const [qrData, setQrData] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_TOTAL);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchQR = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiUrl}/v1/tickets/${ticketId}/qr`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch QR");
      const payload: QRPayload = await res.json();
      const encoded = btoa(JSON.stringify(payload));
      setQrData(encoded);
      setCountdown(COUNTDOWN_TOTAL);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [ticketId, apiUrl, token]);

  // Auto-refresh QR every 25 seconds
  useEffect(() => {
    fetchQR();
    const interval = setInterval(fetchQR, QR_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchQR]);

  // Countdown timer (visual)
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center p-8">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={fetchQR}
          className="rounded-lg bg-primary px-4 py-2 text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center p-8">
      <div className="relative mb-4">
        {loading && !qrData ? (
          <div className="h-[300px] w-[300px] animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
        ) : qrData ? (
          <div className="rounded-xl bg-white p-4 shadow-lg">
            {/* In production, render QR from qrData using a client-side QR library */}
            <div className="flex h-[268px] w-[268px] items-center justify-center border-2 border-dashed border-gray-300 rounded-lg">
              <p className="text-xs text-gray-400 text-center px-4 break-all">
                QR: {qrData.slice(0, 40)}...
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Countdown */}
      <div className="flex items-center gap-2">
        <div className="h-2 w-40 rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-2 rounded-full bg-primary transition-all duration-1000"
            style={{ width: `${(countdown / COUNTDOWN_TOTAL) * 100}%` }}
          />
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400 w-8 text-right">
          {countdown}s
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        QR refreshes automatically. Do not screenshot.
      </p>
    </div>
  );
}
