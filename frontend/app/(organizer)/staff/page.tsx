export default function StaffPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Staff Management
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Add or remove staff members who can scan tickets at the gate.
      </p>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <p className="text-gray-400">No staff members configured</p>
      </div>
    </div>
  );
}
