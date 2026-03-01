import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AuthContext, useAuth, AuthContextType } from "../auth-context";
import { useContext } from "react";

// Helper component that displays auth context values
function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="connected">{String(auth.connected)}</span>
      <span data-testid="wallet">{auth.walletAddress ?? "null"}</span>
      <span data-testid="token">{auth.token ?? "null"}</span>
      <button onClick={auth.login}>Login</button>
      <button onClick={auth.logout}>Logout</button>
    </div>
  );
}

describe("auth-context", () => {
  it("provides default values when no provider is set", () => {
    render(<AuthConsumer />);

    expect(screen.getByTestId("connected")).toHaveTextContent("false");
    expect(screen.getByTestId("wallet")).toHaveTextContent("null");
    expect(screen.getByTestId("token")).toHaveTextContent("null");
  });

  it("provides custom values through AuthContext.Provider", () => {
    const mockLogin = vi.fn();
    const mockLogout = vi.fn();
    const authValue: AuthContextType = {
      connected: true,
      walletAddress: "0xdeadbeef",
      token: "jwt-123",
      login: mockLogin,
      logout: mockLogout,
    };

    render(
      <AuthContext.Provider value={authValue}>
        <AuthConsumer />
      </AuthContext.Provider>
    );

    expect(screen.getByTestId("connected")).toHaveTextContent("true");
    expect(screen.getByTestId("wallet")).toHaveTextContent("0xdeadbeef");
    expect(screen.getByTestId("token")).toHaveTextContent("jwt-123");
  });

  it("useAuth returns the same value as useContext(AuthContext)", () => {
    let directValue: AuthContextType | null = null;
    let hookValue: AuthContextType | null = null;

    function Comparison() {
      directValue = useContext(AuthContext);
      hookValue = useAuth();
      return null;
    }

    const authValue: AuthContextType = {
      connected: true,
      walletAddress: "0x123",
      token: "tok",
      login: vi.fn(),
      logout: vi.fn(),
    };

    render(
      <AuthContext.Provider value={authValue}>
        <Comparison />
      </AuthContext.Provider>
    );

    expect(directValue).toBe(hookValue);
  });
});
