export default function EventsManagePage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Manage Events
        </h1>
        <a
          href="/events/new"
          className="rounded-lg bg-primary px-4 py-2 text-white font-medium hover:bg-indigo-600 transition"
        >
          Create Event
        </a>
      </div>
      <div className="grid gap-4">
        <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
          <p className="text-gray-400">No events created yet</p>
        </div>
      </div>
    </div>
  );
}
