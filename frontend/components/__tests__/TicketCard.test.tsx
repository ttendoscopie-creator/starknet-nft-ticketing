import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import TicketCard from "../TicketCard";

const baseProps = {
  id: "ticket-123",
  eventName: "ETH Paris 2026",
  eventDate: "2026-07-14T00:00:00Z",
  tokenId: "42",
  status: "AVAILABLE" as const,
  ownerAddress: "0xabc123",
};

describe("TicketCard", () => {
  it("renders event name and date", () => {
    render(<TicketCard {...baseProps} />);

    expect(screen.getByText("ETH Paris 2026")).toBeInTheDocument();
    // The date is formatted via toLocaleDateString with en-US
    expect(screen.getByText(/Tuesday, July 14, 2026/)).toBeInTheDocument();
  });

  it("renders token ID", () => {
    render(<TicketCard {...baseProps} />);

    expect(screen.getByText("Token #42")).toBeInTheDocument();
  });

  it("shows correct status badge color for each status", () => {
    const statuses = ["AVAILABLE", "LISTED", "USED", "CANCELLED"] as const;
    const expectedClasses = {
      AVAILABLE: "bg-green-100 text-green-800",
      LISTED: "bg-blue-100 text-blue-800",
      USED: "bg-gray-100 text-gray-800",
      CANCELLED: "bg-red-100 text-red-800",
    };

    for (const status of statuses) {
      const { unmount } = render(
        <TicketCard {...baseProps} status={status} />
      );
      const badge = screen.getByText(status);
      const classes = expectedClasses[status].split(" ");
      for (const cls of classes) {
        expect(badge.className).toContain(cls);
      }
      unmount();
    }
  });

  it("shows QR and List buttons when status is AVAILABLE", () => {
    render(<TicketCard {...baseProps} status="AVAILABLE" />);

    expect(screen.getByText("Show QR")).toBeInTheDocument();
    expect(screen.getByText("List for Sale")).toBeInTheDocument();

    const qrLink = screen.getByText("Show QR").closest("a");
    expect(qrLink).toHaveAttribute("href", "/tickets/ticket-123");

    const listLink = screen.getByText("List for Sale").closest("a");
    expect(listLink).toHaveAttribute("href", "/marketplace/list/ticket-123");
  });

  it("hides action buttons when status is USED", () => {
    render(<TicketCard {...baseProps} status="USED" />);

    expect(screen.queryByText("Show QR")).not.toBeInTheDocument();
    expect(screen.queryByText("List for Sale")).not.toBeInTheDocument();
  });
});
