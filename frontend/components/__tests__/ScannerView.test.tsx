import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// We need to control the Html5Qrcode mock per-test
let mockStart: Mock<(...args: unknown[]) => Promise<void>>;
let mockStop: Mock<(...args: unknown[]) => Promise<void>>;

vi.mock("html5-qrcode", () => ({
  Html5Qrcode: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.start = (...args: unknown[]) => mockStart(...args);
    this.stop = (...args: unknown[]) => mockStop(...args);
  }),
}));

// Stub AudioContext
vi.stubGlobal(
  "AudioContext",
  vi.fn().mockImplementation(function () {
    return {
      createOscillator: () => ({
        connect: vi.fn(),
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: () => ({
        connect: vi.fn(),
        gain: { value: 0 },
      }),
      destination: {},
      currentTime: 0,
    };
  })
);

// Stub indexedDB minimally so the open call resolves
vi.stubGlobal("indexedDB", {
  open: vi.fn().mockImplementation(() => {
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore: vi.fn(),
      transaction: () => {
        const store = {
          put: vi.fn(),
          get: vi.fn().mockReturnValue({ onsuccess: null, result: undefined }),
          getAll: vi.fn().mockReturnValue({
            get onsuccess() { return null; },
            set onsuccess(fn: ((this: unknown) => void) | null) {
              if (fn) {
                Object.defineProperty(this, "result", { value: [], configurable: true });
                fn.call(this);
              }
            },
            result: [],
          }),
        };
        const tx: Record<string, unknown> = {
          objectStore: () => store,
          oncomplete: null,
          onerror: null,
        };
        queueMicrotask(() => {
          if (typeof tx.oncomplete === "function") (tx.oncomplete as () => void)();
        });
        return tx;
      },
    };

    const req: Record<string, unknown> = {
      result: db,
      error: null,
      get onsuccess() { return null; },
      set onsuccess(fn: ((this: unknown) => void) | null) {
        if (fn) queueMicrotask(() => fn.call(req));
      },
      onupgradeneeded: null,
      onerror: null,
    };
    return req;
  }),
});

const defaultProps = {
  apiUrl: "https://api.example.com",
  token: "test-token",
};

import ScannerView from "../ScannerView";

describe("ScannerView", () => {
  beforeEach(() => {
    mockStart = vi.fn().mockResolvedValue(undefined);
    mockStop = vi.fn().mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.restoreAllMocks();
  });

  it("renders without crashing", async () => {
    await act(async () => {
      render(<ScannerView {...defaultProps} />);
    });
  });

  it("shows initializing state by default", async () => {
    mockStart.mockImplementation(() => new Promise(() => {}));

    render(<ScannerView {...defaultProps} />);

    expect(screen.getByText("Initializing camera...")).toBeInTheDocument();
  });

  it("shows the QR reader container", async () => {
    await act(async () => {
      render(<ScannerView {...defaultProps} />);
    });

    const readerEl = document.getElementById("qr-reader");
    expect(readerEl).toBeInTheDocument();
  });

  it("transitions to scanning state after camera starts", async () => {
    await act(async () => {
      render(<ScannerView {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Point camera at QR code")).toBeInTheDocument();
    });
  });

  it("shows camera error when scanner fails to start", async () => {
    mockStart.mockRejectedValue(new Error("Permission denied"));

    await act(async () => {
      render(<ScannerView {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Camera Error")).toBeInTheDocument();
      expect(screen.getByText("Permission denied")).toBeInTheDocument();
    });
  });

  it("hides QR reader div when camera has error", async () => {
    mockStart.mockRejectedValue(new Error("No camera"));

    await act(async () => {
      render(<ScannerView {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Camera Error")).toBeInTheDocument();
    });

    const readerEl = document.getElementById("qr-reader");
    expect(readerEl).not.toBeInTheDocument();
  });

  it("accepts gateId prop without error", async () => {
    await act(async () => {
      render(<ScannerView {...defaultProps} gateId="gate-A" />);
    });

    await waitFor(() => {
      expect(screen.getByText("Point camera at QR code")).toBeInTheDocument();
    });
  });
});
