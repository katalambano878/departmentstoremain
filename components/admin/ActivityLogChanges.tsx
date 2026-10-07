'use client';

const MAX_VALUE_LENGTH = 160;

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

function isDiff(value: unknown): value is { from: unknown; to: unknown } {
  return !!value && typeof value === 'object' && 'from' in (value as object) && 'to' in (value as object);
}

export default function ActivityLogChanges({ action, changes }: { action: string; changes: Record<string, unknown> | null }) {
  if (!changes || Object.keys(changes).length === 0) {
    return <p className="text-sm text-gray-500">No extra details were recorded for this action.</p>;
  }

  const entries = Object.entries(changes);
  const showDiff = action === 'update' || entries.every(([, v]) => isDiff(v));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="py-2 pr-4 font-semibold">Field</th>
            {showDiff ? (
              <>
                <th className="py-2 pr-4 font-semibold">Before</th>
                <th className="py-2 font-semibold">After</th>
              </>
            ) : (
              <th className="py-2 font-semibold">{action === 'delete' ? 'Value when deleted' : 'Value'}</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map(([field, value]) => (
            <tr key={field} className="align-top">
              <td className="py-2 pr-4 font-mono text-xs text-gray-700 whitespace-nowrap">{field}</td>
              {showDiff && isDiff(value) ? (
                <>
                  <td className="py-2 pr-4 text-red-700 break-all">{formatValue(value.from)}</td>
                  <td className="py-2 text-green-700 break-all">{formatValue(value.to)}</td>
                </>
              ) : (
                <td className="py-2 text-gray-900 break-all" colSpan={showDiff ? 2 : 1}>{formatValue(value)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
