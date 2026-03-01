import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Home from "../page";

describe("Home (landing page)", () => {
  it("renders without crashing", () => {
    render(<Home />);
  });

  it("displays the main heading", () => {
    render(<Home />);
    expect(screen.getByText("NFT Ticketing Platform")).toBeInTheDocument();
  });

  it("displays the description text", () => {
    render(<Home />);
    expect(
      screen.getByText(/Secure, transparent event ticketing powered by Starknet/)
    ).toBeInTheDocument();
  });

  it("has a link to My Tickets", () => {
    render(<Home />);
    const link = screen.getByText("My Tickets");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/tickets");
  });

  it("has a link to Browse Marketplace", () => {
    render(<Home />);
    const link = screen.getByText("Browse Marketplace");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/marketplace");
  });
});
