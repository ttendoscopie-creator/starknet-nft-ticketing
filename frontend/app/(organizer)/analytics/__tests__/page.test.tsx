import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import AnalyticsPage from "../page";

describe("AnalyticsPage", () => {
  it("renders without crashing", () => {
    render(<AnalyticsPage />);
  });

  it("displays the heading", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("displays all three metric cards", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("Tickets Sold")).toBeInTheDocument();
    expect(screen.getByText("Tickets Scanned")).toBeInTheDocument();
    expect(screen.getByText("Resale Revenue")).toBeInTheDocument();
  });

  it("shows zero values initially", () => {
    render(<AnalyticsPage />);
    // Two cards show "0" and one shows "0 STRK"
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBe(2);
    expect(screen.getByText("0 STRK")).toBeInTheDocument();
  });
});
