/**
 * Progressive enhancement for Netlify Forms: submit in place instead of
 * leaving the page. Without JS the forms post normally to /thanks.
 */
document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement;
  if (!form.matches('[data-ajax-form]')) return;
  e.preventDefault();

  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const data = new FormData(form);
  const hasFile = [...data.values()].some((v) => v instanceof File && v.size > 0);
  if (button) button.disabled = true;

  try {
    // Netlify accepts multipart for file uploads, urlencoded otherwise.
    const res = await fetch('/', {
      method: 'POST',
      ...(hasFile
        ? { body: data }
        : {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(data as unknown as Record<string, string>).toString(),
          }),
    });
    if (!res.ok) throw new Error(String(res.status));
    form.classList.add('is-done');
    if (status) status.textContent = form.dataset.success ?? 'You are on the list. Thank you.';
    form.dispatchEvent(new CustomEvent('form:done', { bubbles: true }));
  } catch {
    if (status) status.textContent = 'That did not go through. Please try again, or email hello@simonechagoya.com.';
    if (button) button.disabled = false;
  }
});
