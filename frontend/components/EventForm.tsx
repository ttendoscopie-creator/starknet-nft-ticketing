"use client";

import { useState, FormEvent } from "react";

interface EventFormProps {
  apiUrl: string;
  token: string;
  onSuccess?: (event: Record<string, unknown>) => void;
}

export default function EventForm({ apiUrl, token, onSuccess }: EventFormProps) {
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [maxSupply, setMaxSupply] = useState(100);
  const [resaleCapBps, setResaleCapBps] = useState(11000);
  const [royaltyBps, setRoyaltyBps] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/v1/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          eventDate: new Date(eventDate).toISOString(),
          maxSupply,
          resaleCapBps,
          royaltyBps,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create event");
      }

      const event = await res.json();
      onSuccess?.(event);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Event Name
        </label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          placeholder="Summer Music Festival"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Event Date
        </label>
        <input
          type="datetime-local"
          required
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Max Supply
        </label>
        <input
          type="number"
          required
          min={1}
          max={100000}
          value={maxSupply}
          onChange={(e) => setMaxSupply(Number(e.target.value))}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Resale Cap (% of face value)
          </label>
          <input
            type="number"
            min={100}
            max={500}
            value={resaleCapBps / 100}
            onChange={(e) => setResaleCapBps(Number(e.target.value) * 100)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          />
          <p className="text-xs text-gray-400 mt-1">110% = max +10% markup</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Royalty (%)
          </label>
          <input
            type="number"
            min={0}
            max={20}
            value={royaltyBps / 100}
            onChange={(e) => setRoyaltyBps(Number(e.target.value) * 100)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          />
          <p className="text-xs text-gray-400 mt-1">On each resale</p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-primary px-6 py-3 text-white font-medium hover:bg-indigo-600 disabled:opacity-50 transition"
      >
        {loading ? "Creating..." : "Create Event"}
      </button>
    </form>
  );
}
