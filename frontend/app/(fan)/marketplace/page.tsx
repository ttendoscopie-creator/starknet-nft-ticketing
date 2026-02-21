"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Listing {
  id: string;
  price: string;
  sellerAddress: string;
  isActive: boolean;
  ticket: {
    id: string;
    tokenId: string;
    event: {
      name: string;
      eventDate: string;
    };
  };
}

export default function MarketplacePage() {
  const { connected, token, login } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/v1/marketplace/listings`);
      if (!res.ok) throw new Error(`Failed to fetch listings (${res.status})`);
      const data: Listing[] = await res.json();
      setListings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load listings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const handleBuy = useCallback(
    async (listingId: string) => {
      if (!connected) {
        await login();
        return;
      }
      if (!token) return;

      setBuyingId(listingId);
      try {
        const res = await fetch(`${API_URL}/v1/marketplace/listings/${listingId}/buy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Purchase failed");
        }
        await fetchListings();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Purchase failed");
      } finally {
        setBuyingId(null);
      }
    },
    [connected, token, login, fetchListings]
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Marketplace
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Browse and buy tickets from verified sellers. All resales are capped and
        royalties flow to organizers.
      </p>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-56 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 p-8 text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={fetchListings}
            className="rounded-lg bg-primary px-4 py-2 text-white font-medium hover:bg-indigo-600 transition"
          >
            Retry
          </button>
        </div>
      ) : listings.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
            <p className="text-gray-400">No active listings</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <div
              key={listing.id}
              className="rounded-xl border border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition"
            >
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {listing.ticket.event.name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {new Date(listing.ticket.event.eventDate).toLocaleDateString(
                    "en-US",
                    {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }
                  )}
                </p>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                Token #{listing.ticket.tokenId}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                Seller:{" "}
                <span className="font-mono">
                  {listing.sellerAddress.slice(0, 6)}...
                  {listing.sellerAddress.slice(-4)}
                </span>
              </p>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <span className="text-xl font-bold text-gray-900 dark:text-white">
                  {Number(listing.price).toLocaleString()} STRK
                </span>
                <button
                  onClick={() => handleBuy(listing.id)}
                  disabled={buyingId === listing.id}
                  className="rounded-lg bg-primary px-4 py-2 text-sm text-white font-medium hover:bg-indigo-600 disabled:opacity-50 transition"
                >
                  {buyingId === listing.id ? "Buying..." : "Buy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
