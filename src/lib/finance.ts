/**
 * The studio's money math: fees, periods and the dashboard summary.
 *
 * Pure functions over plain records, no Astro or storage imports, so
 * scripts/finance.test.mjs runs this file directly in Node.
 *
 * How profit is counted (the same rule Simone's 2026 Inventory sheet uses):
 *   sales + shipping charged - fees - shipping labels - cost of the pieces sold
 *   - running costs - donations.
 * A piece's cost (beads, clasp, packaging) counts when it sells, from its cost
 * record. Supplies bought in bulk are tracked as spending but not subtracted
 * again, or they would be counted twice. Everything else counts when it is paid.
 * Sales tax collected is passed on to the state, so it is never income.
 */

export type Channel = 'website' | 'etsy' | 'in-person' | 'instagram' | 'commission' | 'other';

export const CHANNELS: Record<Channel, string> = {
  website: 'Website',
  etsy: 'Etsy',
  'in-person': 'In person',
  instagram: 'Instagram or direct',
  commission: 'Commissions',
  other: 'Other',
};

export type SaleItem = {
  title: string;
  /** Product slug, when the item is a piece from the shop. Its cost record supplies the cost. */
  slug?: string;
  qty: number;
  /** What the buyer paid for this line, after discounts, in dollars. */
  amount: number;
  /** Cost to make and package this line, in dollars. Overrides the piece's cost record. */
  cost?: number;
};

export type Sale = {
  id: string;
  /** YYYY-MM-DD, Chicago time. */
  date: string;
  channel: Channel;
  items: SaleItem[];
  /** Shipping the buyer paid. */
  shipping: number;
  /** Payment and marketplace fees: Stripe on the website, Etsy's fees on Etsy. */
  fees: number;
  /** What Simone paid for the shipping label. */
  labelCost: number;
  /** Sales tax collected (owed to the state, not income). */
  tax?: number;
  /** Money given back to the buyer. */
  refunded?: number;
  /** True when the fee is Stripe's standard rate rather than the exact fee. */
  feeEstimated?: boolean;
  dateEstimated?: boolean;
  note?: string;
  /** Where it came from: a Stripe Checkout session id, a request id, or 'manual'. */
  ref?: string;
};

export type ExpenseKind = 'supplies' | 'running' | 'donation';

export const EXPENSE_CATEGORIES: Record<string, ExpenseKind> = {
  'Beads and stones': 'supplies',
  'Clasps and findings': 'supplies',
  Packaging: 'supplies',
  'Art supplies': 'supplies',
  Printing: 'supplies',
  Postage: 'running',
  'Marketing and ads': 'running',
  'Website and software': 'running',
  'Fees and services': 'running',
  'Shows and markets': 'running',
  'Tools and equipment': 'running',
  Other: 'running',
  Donations: 'donation',
};

export const expenseKind = (category: string): ExpenseKind => EXPENSE_CATEGORIES[category] ?? 'running';

export type Expense = {
  id: string;
  date: string;
  category: string;
  vendor: string;
  amount: number;
  note?: string;
};

export type CostRecord = { cost: number; note?: string; updated?: string };
export type Costs = Record<string, CostRecord>;

/* ---------------------------------------------------------------
   Fees
---------------------------------------------------------------- */

export const cents = (n: number) => Math.round(n * 100) / 100;

/** Stripe's standard US card rate: 2.9% + 30 cents on the amount charged. */
export const stripeFee = (charged: number) => (charged > 0 ? cents(charged * 0.029 + 0.3) : 0);

/**
 * What Etsy would have taken on the same order: 6.5% transaction fee and
 * 3% + 25 cents payment processing on items and shipping, plus the 20 cent
 * listing fee. Matches Simone's sheet ($24.20 on $250, $9.95 on $100).
 * Offsite Ads (12 to 15% of some orders) are left out, so this is the floor.
 */
export const etsyFee = (itemsAndShipping: number) =>
  itemsAndShipping > 0 ? cents(itemsAndShipping * 0.095 + 0.45) : 0;

/* ---------------------------------------------------------------
   Dates and periods (Chicago time)
---------------------------------------------------------------- */

const TZ = 'America/Chicago';

/** YYYY-MM-DD for a moment, in Chicago. */
export function chicagoDate(at: Date | number | string = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

export type PeriodKey = 'month' | 'last-month' | 'year' | 'last-year' | 'all';

export type Period = { key: PeriodKey; label: string; from: string; to: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** Periods are [from, to): `to` is the first day after the period. */
export function period(key: PeriodKey, today = chicagoDate()): Period {
  const [y, m] = today.split('-').map(Number);
  const monthStart = (yy: number, mm: number) => {
    const d = new Date(Date.UTC(yy, mm - 1, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
  };
  switch (key) {
    case 'month':
      return { key, label: 'This month', from: monthStart(y, m), to: monthStart(y, m + 1) };
    case 'last-month':
      return { key, label: 'Last month', from: monthStart(y, m - 1), to: monthStart(y, m) };
    case 'year':
      return { key, label: `${y}`, from: `${y}-01-01`, to: `${y + 1}-01-01` };
    case 'last-year':
      return { key, label: `${y - 1}`, from: `${y - 1}-01-01`, to: `${y}-01-01` };
    default:
      return { key: 'all', label: 'All time', from: '0000-01-01', to: '9999-12-31' };
  }
}

export const PERIOD_KEYS: PeriodKey[] = ['month', 'last-month', 'year', 'last-year', 'all'];

export const inPeriod = (date: string, p: Pick<Period, 'from' | 'to'>) => date >= p.from && date < p.to;

/* ---------------------------------------------------------------
   Per-sale numbers
---------------------------------------------------------------- */

/** Cost of one sale line: its own cost, else the piece's cost record times quantity, else unknown. */
export function lineCost(item: SaleItem, costs: Costs): number | null {
  if (typeof item.cost === 'number') return item.cost;
  const record = item.slug ? costs[item.slug] : undefined;
  return record ? cents(record.cost * item.qty) : null;
}

export type SaleMath = {
  gross: number;
  shipping: number;
  fees: number;
  labels: number;
  cogs: number;
  refunded: number;
  tax: number;
  /** Lines sold without any cost on record. */
  missingCost: number;
  net: number;
};

export function saleMath(sale: Sale, costs: Costs): SaleMath {
  const gross = cents(sale.items.reduce((sum, i) => sum + i.amount, 0));
  let cogs = 0;
  let missingCost = 0;
  for (const item of sale.items) {
    const c = lineCost(item, costs);
    if (c === null) missingCost++;
    else cogs += c;
  }
  const refunded = sale.refunded ?? 0;
  const net = gross + sale.shipping - sale.fees - sale.labelCost - cogs - refunded;
  return {
    gross,
    shipping: sale.shipping,
    fees: sale.fees,
    labels: sale.labelCost,
    cogs: cents(cogs),
    refunded,
    tax: sale.tax ?? 0,
    missingCost,
    net: cents(net),
  };
}

/* ---------------------------------------------------------------
   The summary
---------------------------------------------------------------- */

export type ChannelRow = { channel: Channel; label: string; count: number; gross: number; fees: number; net: number };
export type MonthRow = { month: string; label: string; gross: number; net: number; count: number };
export type PieceRow = { key: string; title: string; slug?: string; count: number; gross: number; net: number };

export type Summary = {
  count: number;
  gross: number;
  shipping: number;
  fees: number;
  labels: number;
  cogs: number;
  refunded: number;
  /** Running costs: everything that is not supplies or donations. */
  running: number;
  donations: number;
  /** Supplies bought (cash spent). Not subtracted from profit: piece costs carry it. */
  supplies: number;
  net: number;
  /** net / (gross + shipping), or null when there were no sales. */
  margin: number | null;
  taxCollected: number;
  /** Sale lines sold without a cost on record. */
  missingCost: number;
  /** Sales whose date was estimated. */
  datesEstimated: number;
  /** Sales whose fee is Stripe's standard rate, not the exact fee. */
  feesEstimated: number;
  /** Website orders: what Etsy would have charged, what Stripe charged, and the difference. */
  direct: { orders: number; etsyWouldCharge: number; stripeCharged: number; saved: number };
  etsyFeesPaid: number;
  byChannel: ChannelRow[];
  topPieces: PieceRow[];
};

export function summarize(sales: Sale[], expenses: Expense[], costs: Costs, p: Pick<Period, 'from' | 'to'>): Summary {
  const s: Summary = {
    count: 0,
    gross: 0,
    shipping: 0,
    fees: 0,
    labels: 0,
    cogs: 0,
    refunded: 0,
    running: 0,
    donations: 0,
    supplies: 0,
    net: 0,
    margin: null,
    taxCollected: 0,
    missingCost: 0,
    datesEstimated: 0,
    feesEstimated: 0,
    direct: { orders: 0, etsyWouldCharge: 0, stripeCharged: 0, saved: 0 },
    etsyFeesPaid: 0,
    byChannel: [],
    topPieces: [],
  };
  const channels = new Map<Channel, ChannelRow>();
  const pieces = new Map<string, PieceRow>();

  for (const sale of sales) {
    if (!inPeriod(sale.date, p)) continue;
    const m = saleMath(sale, costs);
    s.count++;
    s.gross += m.gross;
    s.shipping += m.shipping;
    s.fees += m.fees;
    s.labels += m.labels;
    s.cogs += m.cogs;
    s.refunded += m.refunded;
    s.taxCollected += m.tax;
    s.missingCost += m.missingCost;
    if (sale.dateEstimated) s.datesEstimated++;
    if (sale.feeEstimated) s.feesEstimated++;
    if (sale.channel === 'etsy') s.etsyFeesPaid += m.fees;
    if (sale.channel === 'website') {
      s.direct.orders++;
      s.direct.etsyWouldCharge += etsyFee(m.gross + m.shipping);
      s.direct.stripeCharged += m.fees;
    }

    const row = channels.get(sale.channel) ?? { channel: sale.channel, label: CHANNELS[sale.channel], count: 0, gross: 0, fees: 0, net: 0 };
    row.count++;
    row.gross += m.gross;
    row.fees += m.fees;
    row.net += m.net;
    channels.set(sale.channel, row);

    // Per piece: each line's share of the order's shipping, fees and label, by its share of the items.
    const extras = m.shipping - m.fees - m.labels - m.refunded;
    for (const item of sale.items) {
      const share = m.gross > 0 ? item.amount / m.gross : 1 / sale.items.length;
      const key = item.slug ?? item.title.toLowerCase();
      const piece = pieces.get(key) ?? { key, title: item.title, slug: item.slug, count: 0, gross: 0, net: 0 };
      piece.count += item.qty;
      piece.gross += item.amount;
      piece.net += item.amount - (lineCost(item, costs) ?? 0) + extras * share;
      pieces.set(key, piece);
    }
  }

  for (const e of expenses) {
    if (!inPeriod(e.date, p)) continue;
    const kind = expenseKind(e.category);
    if (kind === 'supplies') s.supplies += e.amount;
    else if (kind === 'donation') s.donations += e.amount;
    else s.running += e.amount;
  }

  s.net = s.gross + s.shipping - s.fees - s.labels - s.cogs - s.refunded - s.running - s.donations;
  const revenue = s.gross + s.shipping - s.refunded;
  s.margin = revenue > 0 ? s.net / revenue : null;
  s.direct.saved = s.direct.etsyWouldCharge - s.direct.stripeCharged;

  for (const key of ['gross', 'shipping', 'fees', 'labels', 'cogs', 'refunded', 'running', 'donations', 'supplies', 'net', 'taxCollected', 'etsyFeesPaid'] as const) {
    s[key] = cents(s[key]);
  }
  s.direct = {
    orders: s.direct.orders,
    etsyWouldCharge: cents(s.direct.etsyWouldCharge),
    stripeCharged: cents(s.direct.stripeCharged),
    saved: cents(s.direct.saved),
  };
  s.byChannel = [...channels.values()]
    .map((r) => ({ ...r, gross: cents(r.gross), fees: cents(r.fees), net: cents(r.net) }))
    .sort((a, b) => b.gross - a.gross);
  s.topPieces = [...pieces.values()]
    .map((r) => ({ ...r, gross: cents(r.gross), net: cents(r.net) }))
    .sort((a, b) => b.net - a.net)
    .slice(0, 8);
  return s;
}

/** Sales and net profit for each of the twelve months of a year. Expenses land in the month they were paid. */
export function monthly(sales: Sale[], expenses: Expense[], costs: Costs, year: number): MonthRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const from = `${year}-${pad(i + 1)}-01`;
    const to = i === 11 ? `${year + 1}-01-01` : `${year}-${pad(i + 2)}-01`;
    const sum = summarize(sales, expenses, costs, { from, to });
    const label = new Date(Date.UTC(year, i, 15)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    return { month: from.slice(0, 7), label, gross: sum.gross, net: sum.net, count: sum.count };
  });
}

/* ---------------------------------------------------------------
   Forms and CSV
---------------------------------------------------------------- */

/** "$1,234.50", "1234.5" or "" to a number of dollars (0 for blank or nonsense). */
export function parseMoney(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? cents(n) : 0;
}

/** A YYYY-MM-DD date, or today in Chicago when the input is not one. */
export function parseDate(value: unknown, today = chicagoDate()): string {
  const s = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : today;
}

export function csv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/* ---------------------------------------------------------------
   Display
---------------------------------------------------------------- */

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const wholeDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** "$1,234.50". `whole` drops the cents for headline numbers. */
export const usd = (n: number, whole = false) => (whole ? wholeDollars : dollars).format(n === 0 ? 0 : n);

export const percent = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 100)}%`);

/** "Nov 20" for a YYYY-MM-DD date, with the year when it is not `thisYear`. */
export function dayLabel(date: string, thisYear = chicagoDate().slice(0, 4)) {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.slice(0, 4) === thisYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** The years that have records, newest first, always including this year. */
export function yearsOf(records: { date: string }[], thisYear = chicagoDate().slice(0, 4)) {
  return [...new Set([thisYear, ...records.map((r) => r.date.slice(0, 4))])].filter((y) => /^\d{4}$/.test(y)).sort().reverse();
}
