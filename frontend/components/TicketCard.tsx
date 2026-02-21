"use client";

interface TicketCardProps {
  id: string;
  eventName: string;
  eventDate: string;
  tokenId: string;
  status: "AVAILABLE" | "LISTED" | "USED" | "CANCELLED";
  ownerAddress: string;
}

const statusColors = {
  AVAILABLE: "bg-green-100 text-green-800",
  LISTED: "bg-blue-100 text-blue-800",
  USED: "bg-gray-100 text-gray-800",
  CANCELLED: "bg-red-100 text-red-800",
};

export default function TicketCard({
  id,
  eventName,
  eventDate,
  tokenId,
  status,
}: TicketCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {eventName}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {new Date(eventDate).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${statusColors[status]}`}
        >
          {status}
        </span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Token #{tokenId}
      </p>
      {status === "AVAILABLE" && (
        <div className="flex gap-2">
          <a
            href={`/tickets/${id}`}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-center text-sm text-white font-medium hover:bg-indigo-600 transition"
          >
            Show QR
          </a>
          <a
            href={`/marketplace/list/${id}`}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-center text-sm text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          >
            List for Sale
          </a>
        </div>
      )}
    </div>
  );
}
