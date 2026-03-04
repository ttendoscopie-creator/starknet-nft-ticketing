import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthContext, AuthContextType } from "../../../../auth-context";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ eventId: "test-event-id" }),
}));

// Mock starknet
const mockWaitForTransaction = vi.fn().mockResolvedValue({});
vi.mock("starknet", () => ({
  RpcProvider: class {
    waitForTransaction = mockWaitForTransaction;
  },
  CallData: {
    compile: (args: unknown) => args,
  },
}));

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import CheckoutPage from "../page";

const mockEvent = {
  id: "test-event-id",
  name: "Test Concert",
  eventDate: "2026-06-15T20:00:00Z",
  primaryPrice: 5000000,
  maxSupply: 100,
  acceptedCurrencies: ["USDC", "STRK"],
  organizer: { name: "Test Org", treasuryAddress: "0xtreasury123" },
  _count: { tickets: 10 },
};

const mockExecute = vi.fn().mockResolvedValue({
  transaction_hash: "0xabc123",
});

function renderWithAuth(authOverrides: Partial<AuthContextType> = {}) {
  const auth: AuthContextType = {
    connected: true,
    walletAddress: "0xwallet",
    token: "jwt-test",
    login: vi.fn(),
    logout: vi.fn(),
    getAccount: () => ({ execute: mockExecute }),
    ...authOverrides,
  };

  return render(
    <AuthContext.Provider value={auth}>
      <CheckoutPage />
    </AuthContext.Provider>
  );
}

describe("CheckoutPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("displays event details after loading", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockEvent,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Test Concert")).toBeInTheDocument();
    });
    expect(screen.getByText("By Test Org")).toBeInTheDocument();
    expect(screen.getByText("5.00 USDC")).toBeInTheDocument();
    expect(screen.getByText("90 / 100 remaining")).toBeInTheDocument();
  });

  it("shows connect wallet button when not connected", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockEvent,
    });

    renderWithAuth({ connected: false, walletAddress: null, token: null });

    await waitFor(() => {
      expect(screen.getByText("Test Concert")).toBeInTheDocument();
    });
    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
  });

  it("calls account.execute with correct calldata on pay", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockEvent })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "mint-1", status: "PENDING" }) });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Pay with crypto (USDC)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Pay with crypto (USDC)"));

    await waitFor(() => {
      expect(screen.getByText(/Pay 5.00 USDC/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Pay 5.00 USDC/));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith([
        expect.objectContaining({
          contractAddress: expect.stringContaining("0x053b40a647"),
          entrypoint: "transfer",
        }),
      ]);
    });
  });

  it("calls verify-crypto after tx confirmation", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockEvent })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "mint-1", status: "PENDING" }) });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Pay with crypto (USDC)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Pay with crypto (USDC)"));

    await waitFor(() => {
      expect(screen.getByText(/Pay 5.00 USDC/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Pay 5.00 USDC/));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/payments/verify-crypto"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("0xabc123"),
        })
      );
    }, { timeout: 3000 });
  });

  it("shows success state after verification", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockEvent })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "mint-1", status: "PENDING" }) });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Pay with crypto (USDC)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Pay with crypto (USDC)"));

    await waitFor(() => {
      expect(screen.getByText(/Pay 5.00 USDC/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Pay 5.00 USDC/));

    await waitFor(() => {
      expect(screen.getByText("Payment successful!")).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.getByText("View my tickets")).toHaveAttribute("href", "/tickets");
  });

  it("shows error when event not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Event not found")).toBeInTheDocument();
    });
  });

  it("shows both Stripe and Crypto payment methods", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockEvent,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Pay by card")).toBeInTheDocument();
    });
    expect(screen.getByText("Pay with crypto (USDC)")).toBeInTheDocument();
  });

  it("calls create-checkout-session when Pay by card is clicked", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockEvent })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://checkout.stripe.com/test" }) });

    // Mock window.location.href
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Pay by card")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Pay by card"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/payments/create-checkout-session"),
        expect.objectContaining({ method: "POST" })
      );
    });

    // Restore
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("shows only Pay by card when event does not accept USDC", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockEvent, acceptedCurrencies: ["STRK"] }),
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Pay by card")).toBeInTheDocument();
    });
    expect(screen.queryByText("Pay with crypto (USDC)")).not.toBeInTheDocument();
  });
});
