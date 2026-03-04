"use client";

import { createContext, useContext } from "react";

export interface AuthContextType {
  connected: boolean;
  walletAddress: string | null;
  token: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getAccount: () => unknown | null;
}

export const AuthContext = createContext<AuthContextType>({
  connected: false,
  walletAddress: null,
  token: null,
  login: async () => {},
  logout: async () => {},
  getAccount: () => null,
});

export function useAuth() {
  return useContext(AuthContext);
}
