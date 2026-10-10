/** Fades [data-reveal] elements in as they enter the viewport. */
const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');

if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  // A fully clipped element never reports as intersecting, so mask reveals watch their parent instead.
  const watched = new Map<Element, HTMLElement[]>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        watched.get(entry.target)?.forEach((el) => el.classList.add('is-in'));
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  targets.forEach((el) => {
    const watch = el.dataset.reveal === 'mask' && el.parentElement ? el.parentElement : el;
    watched.set(watch, [...(watched.get(watch) ?? []), el]);
    io.observe(watch);
  });
} else {
  targets.forEach((el) => el.classList.add('is-in'));
}
