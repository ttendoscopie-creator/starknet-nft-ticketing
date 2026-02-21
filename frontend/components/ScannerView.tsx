"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface ScanResult {
  valid: boolean;
  reason?: string;
  ticket_id?: string;
  owner_name?: string;
}

interface ScannerViewProps {
  apiUrl: string;
  token: string;
  gateId?: string;
}

type ScanStatus = "idle" | "scanning" | "valid" | "already_used" | "invalid";

export default function ScannerView({ apiUrl, token, gateId }: ScannerViewProps) {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<HTMLDivElement>(null);

  const processQRData = useCallback(
    async (data: string) => {
      try {
        const decoded = JSON.parse(atob(data));
        const { ticket_id, timestamp, signature } = decoded;

        const res = await fetch(`${apiUrl}/v1/scan/validate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ticket_id, timestamp, signature, gate_id: gateId }),
        });

        const result: ScanResult = await res.json();
        setLastResult(result);

        if (result.valid) {
          setStatus("valid");
          playSound("success");
        } else if (result.reason === "ALREADY_USED") {
          setStatus("already_used");
          playSound("error");
        } else {
          setStatus("invalid");
          playSound("warning");
        }
      } catch {
        setStatus("invalid");
        setLastResult({ valid: false, reason: "PARSE_ERROR" });
        playSound("warning");
      }

      // Reset after 3 seconds
      setTimeout(() => {
        setStatus("scanning");
        setLastResult(null);
      }, 3000);
    },
    [apiUrl, token, gateId]
  );

  useEffect(() => {
    let scanner: { stop: () => Promise<void> } | null = null;

    async function startScanner() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const html5QrCode = new Html5Qrcode("qr-reader");
        scanner = html5QrCode;

        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            processQRData(decodedText);
          },
          () => {} // ignore errors during scanning
        );

        setStatus("scanning");
      } catch (err) {
        setCameraError(
          err instanceof Error ? err.message : "Camera access denied"
        );
      }
    }

    startScanner();

    return () => {
      scanner?.stop().catch(() => {});
    };
  }, [processQRData]);

  function playSound(type: "success" | "error" | "warning") {
    // Web Audio API beep
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.3;

      if (type === "success") {
        osc.frequency.value = 800;
      } else if (type === "error") {
        osc.frequency.value = 300;
      } else {
        osc.frequency.value = 500;
      }

      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // Audio not available
    }
  }

  const statusConfig = {
    idle: { bg: "bg-gray-100", text: "Initializing camera..." },
    scanning: { bg: "bg-blue-50", text: "Point camera at QR code" },
    valid: { bg: "bg-green-100", text: "VALID" },
    already_used: { bg: "bg-red-100", text: "ALREADY USED" },
    invalid: { bg: "bg-orange-100", text: "INVALID" },
  };

  return (
    <div className="flex flex-col items-center">
      {cameraError ? (
        <div className="rounded-xl bg-red-50 p-8 text-center">
          <p className="text-red-600 font-medium mb-2">Camera Error</p>
          <p className="text-red-500 text-sm">{cameraError}</p>
        </div>
      ) : (
        <>
          <div
            ref={scannerRef}
            id="qr-reader"
            className="w-full max-w-md rounded-xl overflow-hidden mb-4"
          />
          <div
            className={`w-full max-w-md rounded-xl p-6 text-center transition-colors ${statusConfig[status].bg}`}
          >
            <p
              className={`text-2xl font-bold ${
                status === "valid"
                  ? "text-green-700"
                  : status === "already_used"
                    ? "text-red-700"
                    : status === "invalid"
                      ? "text-orange-700"
                      : "text-gray-600"
              }`}
            >
              {statusConfig[status].text}
            </p>
            {lastResult?.owner_name && status === "valid" && (
              <p className="text-green-600 mt-2">{lastResult.owner_name}</p>
            )}
            {lastResult?.reason && status !== "valid" && (
              <p className="text-sm text-gray-500 mt-2">{lastResult.reason}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
