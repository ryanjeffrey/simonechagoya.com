/**
 * The timed sale in src/data/site.ts (`site.sale`).
 *
 * The discount is automatic: checkout re-prices eligible lines on the server while the
 * sale is on, so there is no code to enter and none can be stacked on top of it.
 * The site is static, so pages carry both prices and the browser shows the sale price
 * only inside the sale window (see the inline script in Base.astro).
 *
 * No Astro imports here: scripts/sale.test.mjs runs this file directly in Node.
 */
import { site } from '../data/site.ts';

const sale = site.sale;
const starts = sale ? Date.parse(sale.starts) : NaN;
const ends = sale ? Date.parse(sale.ends) : NaN;

/** What the browser needs to decide the phase for itself, or null when no sale is configured. */
export const saleWindow = sale && ends > starts ? { starts, ends, percentOff: sale.percentOff } : null;

/** `soon`: announced, not started. `on`: prices are reduced. `null`: no sale, or it is over. */
export function salePhase(now: number = Date.now()): 'soon' | 'on' | null {
  if (!saleWindow || now >= saleWindow.ends) return null;
  return now >= saleWindow.starts ? 'on' : 'soon';
}

export const saleActive = (now?: number) => salePhase(now) === 'on';

/** Is this piece part of the sale? Only pieces that can be bought, in the sale's categories. */
export function saleCovers(piece: { category: string; status: string; compareAt?: number }) {
  return Boolean(sale && piece.status === 'available' && !piece.compareAt && sale.categories.includes(piece.category));
}

/**
 * What checkout charges for one unit: the sale price while the sale is on and covers the
 * piece, the regular price otherwise. `now` is the server's clock, never the browser's.
 */
export function checkoutPrice(piece: { category: string; status: string; compareAt?: number }, regular: number, now: number = Date.now()) {
  const reduced = saleActive(now) && saleCovers(piece);
  return { unit: reduced ? salePrice(regular) : regular, reduced };
}

/** The sale price in dollars, rounded to the cent. */
export function salePrice(dollars: number) {
  if (!sale) return dollars;
  return Math.round(dollars * (100 - sale.percentOff)) / 100;
}
