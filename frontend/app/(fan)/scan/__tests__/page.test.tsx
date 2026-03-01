import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ScanPage from "../page";

describe("ScanPage", () => {
  it("renders without crashing", () => {
    render(<ScanPage />);
  });

  it("displays the heading", () => {
    render(<ScanPage />);
    expect(screen.getByText("Scan Ticket")).toBeInTheDocument();
  });

  it("displays the staff-only instruction", () => {
    render(<ScanPage />);
    expect(
      screen.getByText(/Staff only\. Point camera at attendee/)
    ).toBeInTheDocument();
  });

  it("shows placeholder for unauthenticated staff", () => {
    render(<ScanPage />);
    expect(
      screen.getByText("Login as staff to activate scanner")
    ).toBeInTheDocument();
  });
});
