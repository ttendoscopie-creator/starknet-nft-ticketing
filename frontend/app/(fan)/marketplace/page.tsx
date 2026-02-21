export default function MarketplacePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Marketplace
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Browse and buy tickets from verified sellers. All resales are capped and
        royalties flow to organizers.
      </p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
          <p className="text-gray-400">No active listings</p>
        </div>
      </div>
    </div>
  );
}
