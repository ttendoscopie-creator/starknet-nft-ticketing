import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import EventsManagePage from "../page";

describe("EventsManagePage", () => {
  it("renders without crashing", () => {
    render(<EventsManagePage />);
  });

  it("displays the heading", () => {
    render(<EventsManagePage />);
    expect(screen.getByText("Manage Events")).toBeInTheDocument();
  });

  it("has a Create Event link", () => {
    render(<EventsManagePage />);
    const link = screen.getByText("Create Event");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/events/new");
  });

  it("shows empty state when no events exist", () => {
    render(<EventsManagePage />);
    expect(screen.getByText("No events created yet")).toBeInTheDocument();
  });
});
