/**
 * When someone opens an accordion (<details>), scroll just enough to show all of it:
 * clear of the sticky header at the top and the product page's buy bar at the bottom.
 * A panel taller than the screen is brought up to sit right under the header.
 * Only user opens count; panels that start open are left where they are.
 */
const GAP = 16;

const opened = new WeakSet<HTMLDetailsElement>();

// A click on a summary (Enter and Space on a focused summary click too) marks its panel as opened by hand.
document.addEventListener('click', (e) => {
  const summary = (e.target as Element | null)?.closest?.('summary');
  const details = summary?.parentElement;
  if (details instanceof HTMLDetailsElement && !details.open) opened.add(details);
});

// `toggle` does not bubble, so listen in the capture phase.
document.addEventListener(
  'toggle',
  (e) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open || !opened.has(details)) return;
    opened.delete(details);
    // Wait a frame so layout that reacts to the new height (a sticky column refitting) has settled.
    requestAnimationFrame(() => requestAnimationFrame(() => reveal(details)));
  },
  true,
);

function reveal(details: HTMLDetailsElement) {
  const rect = details.getBoundingClientRect();
  const header = document.querySelector('.site-header')?.getBoundingClientRect();
  const top = Math.max(0, header?.bottom ?? 0) + GAP;

  // The buy bar slides up from the bottom on phones once the main button scrolls away.
  const bar = document.querySelector<HTMLElement>('[data-sticky-buy]');
  const barRect = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect() : undefined;
  const floor = (barRect && barRect.top < innerHeight ? barRect.top : innerHeight) - GAP;

  if (rect.bottom <= floor) return;
  // Scroll until the bottom shows, but never push the panel's own title under the header.
  const delta = Math.min(rect.bottom - floor, rect.top - top);
  if (delta <= 0) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' });
}
