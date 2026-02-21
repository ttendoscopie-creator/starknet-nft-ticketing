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

type ScanStatus = "idle" | "scanning" | "valid" | "already_used" | "invalid" | "offline_valid";

// --- IndexedDB helpers ---

const DB_NAME = "ticket_scans";
const STORE_NAME = "pending_scans";

interface PendingScan {
  ticket_id: string;
  timestamp: number;
  signature: string;
  gate_id?: string;
  synced: boolean;
  scanned_at: number;
}

function openScanDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "ticket_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePendingScan(scan: PendingScan): Promise<void> {
  const db = await openScanDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(scan);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getUnsyncedScans(): Promise<PendingScan[]> {
  const db = await openScanDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const all = request.result as PendingScan[];
      resolve(all.filter((s) => !s.synced));
    };
    request.onerror = () => reject(request.error);
  });
}

async function markScanSynced(ticketId: string): Promise<void> {
  const db = await openScanDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(ticketId);
    getReq.onsuccess = () => {
      const scan = getReq.result as PendingScan | undefined;
      if (scan) {
        scan.synced = true;
        store.put(scan);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Component ---

export default function ScannerView({ apiUrl, token, gateId }: ScannerViewProps) {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const scannerRef = useRef<HTMLDivElement>(null);

  // Track online/offline status
  useEffect(() => {
    setIsOffline(!navigator.onLine);

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Sync pending scans when back online
  const syncPendingScans = useCallback(async () => {
    try {
      const unsynced = await getUnsyncedScans();
      for (const scan of unsynced) {
        try {
          const res = await fetch(`${apiUrl}/v1/scan/validate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              ticket_id: scan.ticket_id,
              timestamp: scan.timestamp,
              signature: scan.signature,
              gate_id: scan.gate_id,
            }),
          });
          if (res.ok) {
            await markScanSynced(scan.ticket_id);
          }
        } catch {
          // Still offline or server error — will retry next time
          break;
        }
      }
    } catch (err) {
      console.error("Failed to sync pending scans:", err);
    }
  }, [apiUrl, token]);

  useEffect(() => {
    if (!isOffline) {
      syncPendingScans();
    }
  }, [isOffline, syncPendingScans]);

  const processQRData = useCallback(
    async (data: string) => {
      let decoded: { ticket_id: string; timestamp: number; signature: string };
      try {
        decoded = JSON.parse(atob(data));
      } catch {
        setStatus("invalid");
        setLastResult({ valid: false, reason: "PARSE_ERROR" });
        playSound("warning");
        setTimeout(() => {
          setStatus("scanning");
          setLastResult(null);
        }, 3000);
        return;
      }

      const { ticket_id, timestamp, signature } = decoded;

      try {
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
        // Network error — save offline
        try {
          await savePendingScan({
            ticket_id,
            timestamp,
            signature,
            gate_id: gateId,
            synced: false,
            scanned_at: Date.now(),
          });
          setStatus("offline_valid");
          setLastResult({ valid: true, ticket_id, reason: "SAVED_OFFLINE" });
          playSound("success");
        } catch (dbErr) {
          console.error("Failed to save offline scan:", dbErr);
          setStatus("invalid");
          setLastResult({ valid: false, reason: "OFFLINE_SAVE_FAILED" });
          playSound("warning");
        }
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
    offline_valid: { bg: "bg-yellow-100", text: "SAVED OFFLINE" },
  };

  return (
    <div className="flex flex-col items-center">
      {/* Offline badge */}
      {isOffline && (
        <div className="w-full max-w-md mb-4 rounded-lg bg-red-600 px-4 py-2 text-center text-sm font-medium text-white">
          Offline mode
        </div>
      )}

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
                      : status === "offline_valid"
                        ? "text-yellow-700"
                        : "text-gray-600"
              }`}
            >
              {statusConfig[status].text}
            </p>
            {lastResult?.owner_name && status === "valid" && (
              <p className="text-green-600 mt-2">{lastResult.owner_name}</p>
            )}
            {lastResult?.ticket_id && status === "offline_valid" && (
              <p className="text-yellow-600 mt-2 text-sm">
                Ticket {lastResult.ticket_id.slice(0, 8)}... saved for sync
              </p>
            )}
            {lastResult?.reason && status !== "valid" && status !== "offline_valid" && (
              <p className="text-sm text-gray-500 mt-2">{lastResult.reason}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
