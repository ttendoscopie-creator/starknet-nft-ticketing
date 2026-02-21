import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NFT Ticketing",
  description: "Decentralized event ticketing on Starknet",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <nav className="border-b border-gray-200 bg-white dark:bg-gray-800 px-6 py-4">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <a href="/" className="text-xl font-bold text-primary">
              NFT Tickets
            </a>
            <div className="flex gap-4">
              <a
                href="/tickets"
                className="text-gray-600 hover:text-primary dark:text-gray-300"
              >
                My Tickets
              </a>
              <a
                href="/marketplace"
                className="text-gray-600 hover:text-primary dark:text-gray-300"
              >
                Marketplace
              </a>
              <a
                href="/events"
                className="text-gray-600 hover:text-primary dark:text-gray-300"
              >
                Manage Events
              </a>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
