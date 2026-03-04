import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import CheckoutSuccessPage from "../page";

describe("CheckoutSuccessPage", () => {
  it("displays confirmation message", () => {
    render(<CheckoutSuccessPage />);
    expect(screen.getByText("Payment confirmed!")).toBeInTheDocument();
    expect(screen.getByText("Your NFT ticket is being created.")).toBeInTheDocument();
  });

  it("has a link to /tickets", () => {
    render(<CheckoutSuccessPage />);
    const link = screen.getByText("View my tickets");
    expect(link).toHaveAttribute("href", "/tickets");
  });
});
