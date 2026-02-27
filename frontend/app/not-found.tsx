import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-6xl font-bold text-gray-200 dark:text-gray-700 mb-4">
        404
      </h1>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Page not found
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-primary px-6 py-3 text-white font-medium hover:bg-indigo-600 transition"
      >
        Back to home
      </Link>
    </div>
  );
}
