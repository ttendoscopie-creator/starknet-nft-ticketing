import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import StaffPage from "../page";

describe("StaffPage", () => {
  it("renders without crashing", () => {
    render(<StaffPage />);
  });

  it("displays the heading", () => {
    render(<StaffPage />);
    expect(screen.getByText("Staff Management")).toBeInTheDocument();
  });

  it("displays the description", () => {
    render(<StaffPage />);
    expect(
      screen.getByText(
        "Add or remove staff members who can scan tickets at the gate."
      )
    ).toBeInTheDocument();
  });

  it("shows empty state when no staff configured", () => {
    render(<StaffPage />);
    expect(
      screen.getByText("No staff members configured")
    ).toBeInTheDocument();
  });
});
