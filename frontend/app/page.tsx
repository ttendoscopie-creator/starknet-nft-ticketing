export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
        NFT Ticketing Platform
      </h1>
      <p className="text-lg text-gray-600 dark:text-gray-400 mb-8 text-center max-w-2xl">
        Secure, transparent event ticketing powered by Starknet. Buy tickets,
        resell safely with price caps, and validate entry with rotating QR codes.
      </p>
      <div className="flex gap-4">
        <a
          href="/tickets"
          className="rounded-lg bg-primary px-6 py-3 text-white font-medium hover:bg-indigo-600 transition"
        >
          My Tickets
        </a>
        <a
          href="/marketplace"
          className="rounded-lg border border-gray-300 px-6 py-3 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition"
        >
          Browse Marketplace
        </a>
      </div>
    </div>
  );
}
