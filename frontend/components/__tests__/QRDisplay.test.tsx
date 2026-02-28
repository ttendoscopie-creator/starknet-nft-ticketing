import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import QRDisplay from "../QRDisplay";

const defaultProps = {
  ticketId: "ticket-456",
  apiUrl: "https://api.example.com",
  token: "test-jwt-token",
};

const mockQRPayload = {
  ticket_id: "ticket-456",
  timestamp: 1700000000,
  signature: "abc123sig",
};

describe("QRDisplay", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    render(<QRDisplay {...defaultProps} />);

    // The loading placeholder has animate-pulse class
    const pulseEl = document.querySelector(".animate-pulse");
    expect(pulseEl).toBeInTheDocument();
  });

  it("fetches QR data on mount", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockQRPayload,
    });

    render(<QRDisplay {...defaultProps} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/v1/tickets/ticket-456/qr",
        { headers: { Authorization: "Bearer test-jwt-token" } }
      );
    });

    // After fetch resolves, QR data should be displayed (encoded as base64)
    const encoded = btoa(JSON.stringify(mockQRPayload));
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`QR: ${encoded.slice(0, 20)}`))).toBeInTheDocument();
    });
  });

  it("shows error message and retry button on fetch failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(<QRDisplay {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch QR")).toBeInTheDocument();
    });

    const retryButton = screen.getByText("Retry");
    expect(retryButton).toBeInTheDocument();

    // Click retry with a successful response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockQRPayload,
    });

    await userEvent.click(retryButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it("shows countdown timer", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockQRPayload,
    });

    render(<QRDisplay {...defaultProps} />);

    // Wait for QR data to load so the countdown is visible
    await waitFor(() => {
      expect(screen.getByText("30s")).toBeInTheDocument();
    });

    // Advance by 5 seconds
    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(screen.getByText("25s")).toBeInTheDocument();
    });
  });
});
