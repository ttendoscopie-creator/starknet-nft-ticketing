"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Something went wrong
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md">
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-primary px-6 py-3 text-white font-medium hover:bg-indigo-600 transition"
      >
        Try again
      </button>
    </div>
  );
}
