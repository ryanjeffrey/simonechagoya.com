/** Fades [data-reveal] elements in as they enter the viewport. */
const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');

/** Mask reveals wait for their image, so they never unveil an empty frame. Capped so a slow image cannot hold the page. */
function ready(el: HTMLElement): Promise<unknown> {
  const images = [...el.querySelectorAll('img')].map((img) => img.decode().catch(() => {}));
  return Promise.race([Promise.all(images), new Promise((done) => setTimeout(done, 1200))]);
}

function reveal(el: HTMLElement) {
  if (el.dataset.reveal === 'mask') ready(el).then(() => el.classList.add('is-in'));
  else el.classList.add('is-in');
}

if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  // A fully masked element never reports as intersecting, so mask reveals watch their parent instead.
  const watched = new Map<Element, HTMLElement[]>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        watched.get(entry.target)?.forEach(reveal);
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  targets.forEach((el) => {
    const watch = el.dataset.reveal === 'mask' && el.parentElement ? el.parentElement : el;
    watched.set(watch, [...(watched.get(watch) ?? []), el]);
  });
  // Start once the page has arrived, so nothing animates underneath the cross-page fade.
  const arrived = (window as Window & { __arrived?: Promise<void> }).__arrived ?? Promise.resolve();
  arrived.then(() => watched.forEach((_, watch) => io.observe(watch)));
} else {
  targets.forEach((el) => el.classList.add('is-in'));
}
