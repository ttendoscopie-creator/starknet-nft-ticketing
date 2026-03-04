import Link from "next/link";

export default function CheckoutSuccessPage() {
  return (
    <div className="mx-auto max-w-lg py-12">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm text-center">
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-6">
          <p className="text-green-700 dark:text-green-400 font-semibold text-lg mb-2">
            Payment confirmed!
          </p>
          <p className="text-green-600 dark:text-green-500 text-sm mb-4">
            Your NFT ticket is being created.
          </p>
          <Link
            href="/tickets"
            className="inline-block rounded-lg bg-primary px-6 py-2 text-white font-medium hover:bg-indigo-600 transition"
          >
            View my tickets
          </Link>
        </div>
      </div>
    </div>
  );
}
