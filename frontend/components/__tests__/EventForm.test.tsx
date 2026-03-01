import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EventForm from "../EventForm";

const defaultProps = {
  apiUrl: "https://api.example.com",
  token: "test-jwt-token",
};

describe("EventForm", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing", () => {
    render(<EventForm {...defaultProps} />);
  });

  it("displays all form fields", () => {
    render(<EventForm {...defaultProps} />);

    expect(screen.getByText("Event Name")).toBeInTheDocument();
    expect(screen.getByText("Event Date")).toBeInTheDocument();
    expect(screen.getByText("Max Supply")).toBeInTheDocument();
    expect(
      screen.getByText("Resale Cap (% of face value)")
    ).toBeInTheDocument();
    expect(screen.getByText("Royalty (%)")).toBeInTheDocument();
  });

  it("has a submit button", () => {
    render(<EventForm {...defaultProps} />);

    const button = screen.getByText("Create Event");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "submit");
  });

  it("shows placeholder text in event name input", () => {
    render(<EventForm {...defaultProps} />);

    expect(
      screen.getByPlaceholderText("Summer Music Festival")
    ).toBeInTheDocument();
  });

  it("displays helper text for resale cap and royalty", () => {
    render(<EventForm {...defaultProps} />);

    expect(
      screen.getByText("110% = max +10% markup")
    ).toBeInTheDocument();
    expect(screen.getByText("On each resale")).toBeInTheDocument();
  });

  it("submits form data to API", async () => {
    const onSuccess = vi.fn();
    const mockEvent = { id: "evt-1", name: "Test Event" };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockEvent,
    });

    render(<EventForm {...defaultProps} onSuccess={onSuccess} />);

    await userEvent.type(
      screen.getByPlaceholderText("Summer Music Festival"),
      "My Concert"
    );

    const dateInput = screen.getByDisplayValue("");
    await userEvent.type(dateInput, "2026-08-20T19:00");

    await userEvent.click(screen.getByText("Create Event"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/v1/events",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-jwt-token",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(mockEvent);
    });
  });

  it("shows Creating... while submitting", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    render(<EventForm {...defaultProps} />);

    await userEvent.type(
      screen.getByPlaceholderText("Summer Music Festival"),
      "My Concert"
    );

    // We need to fill required fields so form submits.
    // The date field is also required — use a workaround by finding the datetime-local input
    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    if (inputs[0]) {
      await userEvent.type(inputs[0] as HTMLInputElement, "2026-08-20T19:00");
    }

    await userEvent.click(screen.getByText("Create Event"));

    await waitFor(() => {
      expect(screen.getByText("Creating...")).toBeInTheDocument();
    });
  });

  it("shows error message on failed submission", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Event name already exists" }),
    });

    render(<EventForm {...defaultProps} />);

    await userEvent.type(
      screen.getByPlaceholderText("Summer Music Festival"),
      "Duplicate Event"
    );

    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    if (inputs[0]) {
      await userEvent.type(inputs[0] as HTMLInputElement, "2026-08-20T19:00");
    }

    await userEvent.click(screen.getByText("Create Event"));

    await waitFor(() => {
      expect(
        screen.getByText("Event name already exists")
      ).toBeInTheDocument();
    });
  });

  it("disables submit button while loading", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    render(<EventForm {...defaultProps} />);

    await userEvent.type(
      screen.getByPlaceholderText("Summer Music Festival"),
      "My Concert"
    );

    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    if (inputs[0]) {
      await userEvent.type(inputs[0] as HTMLInputElement, "2026-08-20T19:00");
    }

    await userEvent.click(screen.getByText("Create Event"));

    await waitFor(() => {
      const button = screen.getByText("Creating...");
      expect(button).toBeDisabled();
    });
  });
});
