import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthContext, AuthContextType } from "../../../auth-context";
import MarketplacePage from "../page";

const mockLogin = vi.fn();
const mockLogout = vi.fn();

function renderWithAuth(overrides: Partial<AuthContextType> = {}) {
  const authValue: AuthContextType = {
    connected: false,
    walletAddress: null,
    token: null,
    login: mockLogin,
    logout: mockLogout,
    getAccount: () => null,
    ...overrides,
  };

  return render(
    <AuthContext.Provider value={authValue}>
      <MarketplacePage />
    </AuthContext.Provider>
  );
}

const mockListings = [
  {
    id: "listing-1",
    price: "500",
    sellerAddress: "0xabcdef1234567890",
    isActive: true,
    ticket: {
      id: "t1",
      tokenId: "42",
      event: {
        name: "StarkNet Summit",
        eventDate: "2026-09-15T00:00:00Z",
      },
    },
  },
];

describe("MarketplacePage", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing", () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );
    renderWithAuth();
  });

  it("displays heading and description", () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );
    renderWithAuth();

    expect(screen.getByText("Marketplace")).toBeInTheDocument();
    expect(
      screen.getByText(/Browse and buy tickets from verified sellers/)
    ).toBeInTheDocument();
  });

  it("shows loading skeleton on initial load", () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );
    renderWithAuth();

    const pulseElements = document.querySelectorAll(".animate-pulse");
    expect(pulseElements.length).toBe(3);
  });

  it("shows listings after successful fetch", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockListings,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("StarkNet Summit")).toBeInTheDocument();
    });

    expect(screen.getByText("Token #42")).toBeInTheDocument();
    expect(screen.getByText(/0xabcd/)).toBeInTheDocument();
    expect(screen.getByText("500 STRK")).toBeInTheDocument();
    expect(screen.getByText("Buy")).toBeInTheDocument();
  });

  it("shows empty state when no listings", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("No active listings")).toBeInTheDocument();
    });
  });

  it("shows error state on fetch failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(
        screen.getByText("Failed to fetch listings (503)")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("retries fetch on Retry button click", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await userEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it("calls login when Buy clicked while disconnected", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockListings,
    });

    renderWithAuth({ connected: false });

    await waitFor(() => {
      expect(screen.getByText("Buy")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Buy"));

    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it("sends buy request when connected and Buy clicked", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockListings,
    });

    renderWithAuth({ connected: true, token: "jwt-token", walletAddress: "0x123" });

    await waitFor(() => {
      expect(screen.getByText("Buy")).toBeInTheDocument();
    });

    // Mock the buy POST and then the subsequent re-fetch
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

    await userEvent.click(screen.getByText("Buy"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/marketplace/listings/listing-1/buy"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer jwt-token",
          }),
        })
      );
    });
  });

  it("shows Buying... text while purchase is in progress", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockListings,
    });

    renderWithAuth({ connected: true, token: "jwt-token", walletAddress: "0x123" });

    await waitFor(() => {
      expect(screen.getByText("Buy")).toBeInTheDocument();
    });

    // Buy request that never resolves
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    await userEvent.click(screen.getByText("Buy"));

    await waitFor(() => {
      expect(screen.getByText("Buying...")).toBeInTheDocument();
    });
  });
});
