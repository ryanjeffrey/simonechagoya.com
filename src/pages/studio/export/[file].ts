/**
 * Downloads for Simone's records and her accountant: sales, expenses and
 * requests as CSV, and a full JSON backup that /studio/costs can load back.
 * Signed-in only, like every studio page.
 */
import type { APIRoute } from 'astro';
import { CHANNELS, chicagoDate, csv, expenseKind, saleMath } from '../../../lib/finance';
import { REQUEST_STATUSES, balanceDue, exportAll, paid } from '../../../lib/ledger';
import { isSignedIn } from '../../../lib/studio-auth';
import { loadLedger } from '../../../lib/studio-data';
import { studioStore } from '../../../lib/studio-store';

export const prerender = false;

export const GET: APIRoute = async ({ params, cookies }) => {
  if (!(await isSignedIn(cookies))) return new Response('Sign in at /studio first.', { status: 401 });
  const kv = studioStore();
  if (!kv) return new Response('The studio store is not available.', { status: 503 });

  const stamp = chicagoDate();
  const file = params.file ?? '';
  const send = (body: string, type: string, name: string) =>
    new Response(body, {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });

  if (file === 'backup.json') {
    return send(JSON.stringify(await exportAll(kv), null, 2), 'application/json', `studio-backup-${stamp}.json`);
  }

  const ledger = await loadLedger(kv, { website: file === 'sales.csv' });

  if (file === 'sales.csv') {
    const rows = ledger.sales.map((s) => {
      const m = saleMath(s, ledger.costs);
      return [
        s.date,
        CHANNELS[s.channel],
        s.items.map((i) => (i.qty > 1 ? `${i.title} x${i.qty}` : i.title)).join('; '),
        s.items.reduce((n, i) => n + i.qty, 0),
        m.gross,
        m.shipping,
        m.tax,
        m.fees,
        m.labels,
        m.missingCost ? '' : m.cogs,
        m.refunded,
        m.net,
        [s.dateEstimated && 'date guessed', s.feeEstimated && 'fee estimated', m.missingCost && 'no piece cost'].filter(Boolean).join('; '),
        s.note ?? '',
        s.ref ?? '',
      ];
    });
    return send(
      csv([
        ['Date', 'Channel', 'Items', 'Quantity', 'Sales', 'Shipping charged', 'Sales tax collected', 'Fees', 'Shipping label', 'Piece cost', 'Refunded', 'Net profit', 'Flags', 'Note', 'Reference'],
        ...rows,
      ]),
      'text/csv; charset=utf-8',
      `studio-sales-${stamp}.csv`,
    );
  }

  if (file === 'expenses.csv') {
    const kinds = { supplies: 'Supplies', running: 'Running cost', donation: 'Donation' } as const;
    return send(
      csv([
        ['Date', 'Category', 'Kind', 'Paid to', 'Amount', 'Note'],
        ...ledger.expenses.map((e) => [e.date, e.category, kinds[expenseKind(e.category)], e.vendor, e.amount, e.note ?? '']),
      ]),
      'text/csv; charset=utf-8',
      `studio-expenses-${stamp}.csv`,
    );
  }

  if (file === 'requests.csv') {
    const sorted = [...ledger.requests].sort((a, b) => b.created.localeCompare(a.created));
    return send(
      csv([
        ['Came in', 'Name', 'Email', 'Phone', 'Source', 'Type', 'Status', 'Budget', 'Quote', 'Paid', 'Still owed', 'Cost', 'Due', 'Follow up', 'Message', 'Notes'],
        ...sorted.map((r) => [
          chicagoDate(r.created),
          r.name,
          r.email ?? '',
          r.phone ?? '',
          r.source,
          r.type,
          REQUEST_STATUSES[r.status] ?? r.status,
          r.budget ?? '',
          r.quote ?? '',
          paid(r),
          balanceDue(r),
          r.cost ?? '',
          r.due ?? '',
          r.followUp ?? '',
          r.message,
          r.notes ?? '',
        ]),
      ]),
      'text/csv; charset=utf-8',
      `studio-requests-${stamp}.csv`,
    );
  }

  return new Response('Not found', { status: 404 });
};
