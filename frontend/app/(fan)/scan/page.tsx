export default function ScanPage() {
  return (
    <div className="flex flex-col items-center">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Scan Ticket
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8 text-center">
        Staff only. Point camera at attendee&apos;s QR code to validate entry.
      </p>
      {/* ScannerView component rendered here after staff auth */}
      <div className="w-full max-w-md rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-16 text-center">
        <p className="text-gray-400">Login as staff to activate scanner</p>
      </div>
    </div>
  );
}
