import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthContext, AuthContextType } from "../../../auth-context";
import TicketsPage from "../page";

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
      <TicketsPage />
    </AuthContext.Provider>
  );
}

describe("TicketsPage", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing", () => {
    renderWithAuth();
  });

  it("shows connect wallet prompt when not connected", () => {
    renderWithAuth({ connected: false });

    expect(screen.getByText("My Tickets")).toBeInTheDocument();
    expect(
      screen.getByText("Connect your wallet to view your NFT tickets.")
    ).toBeInTheDocument();
    expect(screen.getByText("Connect your wallet")).toBeInTheDocument();
  });

  it("calls login when connect wallet button is clicked", async () => {
    renderWithAuth({ connected: false });

    await userEvent.click(screen.getByText("Connect your wallet"));
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it("shows loading state when fetching tickets", () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    renderWithAuth({ connected: true, token: "test-token", walletAddress: "0x123" });

    expect(screen.getByText("My Tickets")).toBeInTheDocument();
    const pulseElements = document.querySelectorAll(".animate-pulse");
    expect(pulseElements.length).toBe(3);
  });

  it("shows tickets after successful fetch", async () => {
    const mockTickets = [
      {
        id: "t1",
        tokenId: "10",
        status: "AVAILABLE",
        ownerAddress: "0xabc",
        event: { name: "ETH Paris", eventDate: "2026-07-14T00:00:00Z" },
      },
    ];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockTickets,
    });

    renderWithAuth({ connected: true, token: "test-token", walletAddress: "0x123" });

    await waitFor(() => {
      expect(screen.getByText("ETH Paris")).toBeInTheDocument();
    });
  });

  it("shows empty state when no tickets", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    renderWithAuth({ connected: true, token: "test-token", walletAddress: "0x123" });

    await waitFor(() => {
      expect(screen.getByText("No tickets yet")).toBeInTheDocument();
    });

    expect(screen.getByText("Browse events")).toBeInTheDocument();
    const browseLink = screen.getByText("Browse events").closest("a");
    expect(browseLink).toHaveAttribute("href", "/marketplace");
  });

  it("shows error state on fetch failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    renderWithAuth({ connected: true, token: "test-token", walletAddress: "0x123" });

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch tickets (500)")).toBeInTheDocument();
    });

    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("retries fetch on Retry button click", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    renderWithAuth({ connected: true, token: "test-token", walletAddress: "0x123" });

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

  it("passes correct Authorization header to fetch", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    renderWithAuth({ connected: true, token: "my-jwt", walletAddress: "0x123" });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/tickets"),
        expect.objectContaining({
          headers: { Authorization: "Bearer my-jwt" },
        })
      );
    });
  });
});
