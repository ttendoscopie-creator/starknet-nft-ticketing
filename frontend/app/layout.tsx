"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { StarkZap, OnboardStrategy } from "starkzap";
import { AuthContext, useAuth } from "./auth-context";
import "./globals.css";

// --- StarkZap / Cartridge Config ---

const NETWORK = (process.env.NEXT_PUBLIC_STARKNET_NETWORK || "sepolia") as
  | "sepolia"
  | "mainnet";
const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "";
const MARKETPLACE_ADDRESS =
  process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || "";
const USDC_ADDRESS =
  "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080";

// --- Auth Provider ---

function AuthProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const sdkRef = useRef<StarkZap | null>(null);
  const walletRef = useRef<unknown>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("wallet_address");
    if (stored) setWalletAddress(stored);

    const storedToken = sessionStorage.getItem("auth_token");
    if (storedToken) setToken(storedToken);

    const sdk = new StarkZap({
      network: NETWORK,
      paymaster: {
        nodeUrl: `${API_URL}/v1/paymaster`,
      },
    });
    sdkRef.current = sdk;
    setReady(true);
  }, []);

  const login = useCallback(async () => {
    const sdk = sdkRef.current;
    if (!sdk || !ready) return;

    try {
      // Build Cartridge session policies for contracts users interact with
      const policies: Array<{ target: string; method: string }> = [];

      if (MARKETPLACE_ADDRESS) {
        policies.push(
          { target: MARKETPLACE_ADDRESS, method: "list_ticket" },
          { target: MARKETPLACE_ADDRESS, method: "buy_ticket" },
          { target: MARKETPLACE_ADDRESS, method: "cancel_listing" },
        );
      }
      if (FACTORY_ADDRESS) {
        policies.push({
          target: FACTORY_ADDRESS,
          method: "create_event",
        });
      }

      // ERC20 USDC transfer policy for crypto payments
      policies.push({ target: USDC_ADDRESS, method: "transfer" });

      const onboard = await sdk.onboard({
        strategy: OnboardStrategy.Cartridge,
        cartridge: { policies },
      });

      const wallet = onboard.wallet;
      walletRef.current = wallet;
      const address = wallet.address;

      setWalletAddress(address);
      sessionStorage.setItem("wallet_address", address);
    } catch (err) {
      console.error("Login failed:", err);
    }
  }, [ready]);

  const getAccount = useCallback(() => {
    return walletRef.current;
  }, []);

  const logout = useCallback(async () => {
    walletRef.current = null;
    setWalletAddress(null);
    setToken(null);
    sessionStorage.removeItem("wallet_address");
    sessionStorage.removeItem("auth_token");
  }, []);

  return (
    <AuthContext.Provider
      value={{
        connected: !!walletAddress,
        walletAddress,
        token,
        login,
        logout,
        getAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// --- NavBar ---

function NavBar() {
  const { connected, walletAddress, login, logout } = useAuth();

  const truncated = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : "";

  return (
    <nav className="border-b border-gray-200 bg-white dark:bg-gray-800 px-6 py-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <a href="/" className="text-xl font-bold text-primary">
          NFT Tickets
        </a>
        <div className="flex items-center gap-4">
          <a
            href="/tickets"
            className="text-gray-600 hover:text-primary dark:text-gray-300"
          >
            My Tickets
          </a>
          <a
            href="/marketplace"
            className="text-gray-600 hover:text-primary dark:text-gray-300"
          >
            Marketplace
          </a>
          <a
            href="/events"
            className="text-gray-600 hover:text-primary dark:text-gray-300"
          >
            Manage Events
          </a>
          {connected ? (
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1 text-sm font-mono text-gray-700 dark:text-gray-300">
                {truncated}
              </span>
              <button
                onClick={logout}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 transition"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={login}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-white font-medium hover:bg-indigo-600 transition"
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

// --- Root Layout ---

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>NFT Tickets — Starknet Event Ticketing</title>
        <meta
          name="description"
          content="Secure, transparent event ticketing powered by Starknet. Buy tickets, resell safely with price caps, and validate entry with rotating QR codes."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <AuthProvider>
          <NavBar />
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
