export default function TicketsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        My Tickets
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Connect your wallet to view your NFT tickets.
      </p>
      {/* TicketCard components rendered here after auth */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
          <p className="text-gray-400">No tickets yet</p>
          <a
            href="/marketplace"
            className="mt-4 inline-block text-primary hover:underline"
          >
            Browse events
          </a>
        </div>
      </div>
    </div>
  );
}
