/**
 * Simone's records in the private studio store (see studio-store.ts):
 *
 *   sales/<id>       sales made outside the website: Etsy, in person, Instagram
 *   expenses/<id>    money spent, by category
 *   requests/<id>    commissions and other inquiries, with quotes and payments
 *   costs            cost to make and package each piece, by product slug
 *
 * Website orders are not stored here: Stripe is their record (website-sales.ts).
 * Payments received on a commission become sales in the 'commission' channel.
 */
import { cents, type Costs, type Expense, type Sale } from './finance.ts';
import type { KV } from './studio-store.ts';

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function all<T>(kv: KV, prefix: string): Promise<T[]> {
  const keys = await kv.keys(prefix);
  const rows: (T | null)[] = await Promise.all(keys.map((k) => kv.getJSON<T>(k)));
  return rows.filter((r): r is T => r !== null);
}

/* Sales and expenses ------------------------------------------------ */

export const listSales = (kv: KV) => all<Sale>(kv, 'sales/');
export const getSale = (kv: KV, id: string) => kv.getJSON<Sale>(`sales/${id}`);
export const saveSale = (kv: KV, sale: Sale) => kv.setJSON(`sales/${sale.id}`, sale);
export const deleteSale = (kv: KV, id: string) => kv.delete(`sales/${id}`);

export const listExpenses = (kv: KV) => all<Expense>(kv, 'expenses/');
export const getExpense = (kv: KV, id: string) => kv.getJSON<Expense>(`expenses/${id}`);
export const saveExpense = (kv: KV, e: Expense) => kv.setJSON(`expenses/${e.id}`, e);
export const deleteExpense = (kv: KV, id: string) => kv.delete(`expenses/${id}`);

/* Costs --------------------------------------------------------------- */

export const getCosts = async (kv: KV) => (await kv.getJSON<Costs>('costs')) ?? {};
export const saveCosts = (kv: KV, costs: Costs) => kv.setJSON('costs', costs);

/* Requests ------------------------------------------------------------ */

export const REQUEST_STATUSES = {
  new: 'New',
  replied: 'Replied',
  quoted: 'Quoted',
  booked: 'Booked',
  making: 'In progress',
  delivered: 'Delivered',
  closed: 'Closed',
} as const;
export type RequestStatus = keyof typeof REQUEST_STATUSES;

/** Statuses that still need Simone: everything before delivered or closed. */
export const OPEN_STATUSES: RequestStatus[] = ['new', 'replied', 'quoted', 'booked', 'making'];

export const REQUEST_TYPES = [
  'Custom necklace',
  'Painting commission',
  'Original painting',
  'Order question',
  'Wholesale or stockist',
  'Something else',
] as const;

export const REQUEST_SOURCES = ['Website form', 'Email', 'Instagram', 'In person', 'Referral', 'Other'] as const;

export type Payment = { id: string; date: string; amount: number; method?: string; note?: string };

export type Request = {
  id: string;
  /** ISO time it came in. */
  created: string;
  source: string;
  name: string;
  email?: string;
  phone?: string;
  type: string;
  budget?: string;
  piece?: string;
  message: string;
  /** Link to a reference image sent with the form. */
  attachment?: string;
  status: RequestStatus;
  /** The agreed price, in dollars. */
  quote?: number;
  /** What the work costs to make (materials, framing, shipping), in dollars. */
  cost?: number;
  due?: string;
  followUp?: string;
  notes?: string;
  payments: Payment[];
  updated: string;
};

export const listRequests = (kv: KV) => all<Request>(kv, 'requests/');
export const getRequest = (kv: KV, id: string) => kv.getJSON<Request>(`requests/${id}`);
export const saveRequest = (kv: KV, r: Request) => kv.setJSON(`requests/${r.id}`, { ...r, updated: new Date().toISOString() });
export const deleteRequest = (kv: KV, id: string) => kv.delete(`requests/${id}`);

export const paid = (r: Request) => cents(r.payments.reduce((sum, p) => sum + p.amount, 0));
export const balanceDue = (r: Request) => (r.quote ? Math.max(0, cents(r.quote - paid(r))) : 0);

/**
 * Commission payments as sales, dated when the money came in. The work's cost
 * is spread over the payments by their share of the quote (all of it on the
 * first payment when there is no quote), so profit lands as the money does.
 */
export function requestSales(requests: Request[]): Sale[] {
  return requests.flatMap((r) =>
    r.payments.map((p, i) => {
      const share = r.quote ? p.amount / r.quote : i === 0 ? 1 : 0;
      return {
        id: `${r.id}:${p.id}`,
        date: p.date,
        channel: 'commission' as const,
        items: [
          {
            title: `${r.type}${r.name ? `, ${r.name}` : ''}`,
            qty: 1,
            amount: p.amount,
            cost: r.cost ? cents(r.cost * share) : 0,
          },
        ],
        shipping: 0,
        fees: 0,
        labelCost: 0,
        note: p.note,
        ref: r.id,
      } satisfies Sale;
    }),
  );
}

/* Backup -------------------------------------------------------------- */

export type Backup = {
  version: 1;
  exported?: string;
  costs?: Costs;
  sales?: Sale[];
  expenses?: Expense[];
  requests?: Request[];
};

export async function exportAll(kv: KV): Promise<Backup> {
  const [costs, sales, expenses, requests] = await Promise.all([getCosts(kv), listSales(kv), listExpenses(kv), listRequests(kv)]);
  return { version: 1, exported: new Date().toISOString(), costs, sales, expenses, requests };
}

/**
 * Loads a backup (or a prepared import file). Records are matched by id, so
 * loading the same file twice changes nothing. Costs merge piece by piece.
 */
export async function importAll(kv: KV, data: Backup) {
  if (data?.version !== 1) throw new Error('This is not a studio backup file.');
  const counts = { costs: 0, sales: 0, expenses: 0, requests: 0 };
  if (data.costs && typeof data.costs === 'object') {
    const costs = await getCosts(kv);
    for (const [slug, record] of Object.entries(data.costs)) {
      if (typeof record?.cost !== 'number') continue;
      costs[slug] = { cost: cents(record.cost), note: record.note, updated: record.updated ?? new Date().toISOString() };
      counts.costs++;
    }
    await saveCosts(kv, costs);
  }
  for (const s of data.sales ?? []) {
    if (!s?.id || !s.date || !Array.isArray(s.items)) continue;
    await saveSale(kv, s);
    counts.sales++;
  }
  for (const e of data.expenses ?? []) {
    if (!e?.id || !e.date || typeof e.amount !== 'number') continue;
    await saveExpense(kv, e);
    counts.expenses++;
  }
  for (const r of data.requests ?? []) {
    if (!r?.id || !r.created) continue;
    await kv.setJSON(`requests/${r.id}`, { ...r, payments: r.payments ?? [] });
    counts.requests++;
  }
  return counts;
}
