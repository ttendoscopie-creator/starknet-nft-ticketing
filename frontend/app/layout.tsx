"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { Web3Auth } from "@web3auth/modal";
import { CommonPrivateKeyProvider } from "@web3auth/base-provider";
import { CHAIN_NAMESPACES } from "@web3auth/base";
import { ec } from "starknet";
import { AuthContext, useAuth } from "./auth-context";
import "./globals.css";

// --- Web3Auth Config ---

const CLIENT_ID = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID || "";

const chainConfig = {
  chainNamespace: CHAIN_NAMESPACES.OTHER,
  chainId: "0x534e5f5345504f4c4941",
  rpcTarget: "https://starknet-sepolia.public.blastapi.io",
  displayName: "Starknet Sepolia",
  ticker: "STRK",
  tickerName: "Starknet",
};

// --- Auth Provider ---

function AuthProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const web3authRef = useRef<Web3Auth | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("wallet_address");
    if (stored) setWalletAddress(stored);

    const privateKeyProvider = new CommonPrivateKeyProvider({ config: { chainConfig } });

    const web3auth = new Web3Auth({
      clientId: CLIENT_ID,
      web3AuthNetwork: "sapphire_devnet",
      privateKeyProvider,
    });

    web3authRef.current = web3auth;

    web3auth
      .initModal()
      .then(async () => {
        setReady(true);
        if (web3auth.connected && web3auth.provider) {
          await extractCredentials(web3auth);
        }
      })
      .catch((err) => {
        console.error("Web3Auth init failed:", err);
        setReady(true);
      });
  }, []);

  const extractCredentials = useCallback(async (web3auth: Web3Auth) => {
    try {
      const provider = web3auth.provider;
      if (!provider) return;

      const privKeyHex = (await provider.request({ method: "private_key" })) as string;
      const starkKey = ec.starkCurve.getStarkKey(privKeyHex);
      const address = starkKey.startsWith("0x") ? starkKey : "0x" + starkKey;

      setWalletAddress(address);
      sessionStorage.setItem("wallet_address", address);

      try {
        const authInfo = await web3auth.authenticateUser();
        setToken(authInfo.idToken);
      } catch {
        // idToken not available — use address as fallback identifier
      }
    } catch (err) {
      console.error("Failed to extract credentials:", err);
    }
  }, []);

  const login = useCallback(async () => {
    const web3auth = web3authRef.current;
    if (!web3auth || !ready) return;

    try {
      await web3auth.connect();
      if (web3auth.connected) {
        await extractCredentials(web3auth);
      }
    } catch (err) {
      console.error("Login failed:", err);
    }
  }, [ready, extractCredentials]);

  const logout = useCallback(async () => {
    const web3auth = web3authRef.current;
    if (!web3auth) return;

    try {
      await web3auth.logout();
    } catch {
      // Already logged out
    }

    setWalletAddress(null);
    setToken(null);
    sessionStorage.removeItem("wallet_address");
  }, []);

  return (
    <AuthContext.Provider
      value={{
        connected: !!walletAddress,
        walletAddress,
        token,
        login,
        logout,
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
      <body className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <AuthProvider>
          <NavBar />
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
