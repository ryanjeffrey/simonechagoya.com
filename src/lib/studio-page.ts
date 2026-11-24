/**
 * What every studio page does first: no caching or indexing, sign in and sign
 * out, and a way back to the page with a message after a form is sent.
 */
import type { AstroGlobal } from 'astro';
import { isSignedIn, signIn, signOut } from './studio-auth';

export type StudioRequest = {
  signedIn: boolean;
  /** Set when the page must answer with this response straight away (a redirect after sign-in). */
  response?: Response;
  /** The posted form and its `action`, once signed in. */
  form?: FormData;
  action?: string;
  /** Redirects back to `path` with a message key, keeping the given query values. */
  back: (msg: string, params?: Record<string, string | undefined>, why?: unknown) => Response;
};

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 240);

export async function studioRequest(Astro: AstroGlobal, path: string): Promise<StudioRequest> {
  Astro.response.headers.set('Cache-Control', 'no-store');
  Astro.response.headers.set('X-Robots-Tag', 'noindex');

  const back: StudioRequest['back'] = (msg, params = {}, why) => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) query.set(k, v);
    if (msg) query.set('msg', msg);
    if (why) query.set('why', reason(why));
    const qs = query.toString();
    return Astro.redirect(qs ? `${path}?${qs}` : path, 303);
  };

  const signedIn = await isSignedIn(Astro.cookies);
  if (Astro.request.method !== 'POST') return { signedIn, back };

  const form = await Astro.request.formData();
  const action = String(form.get('action') ?? '');
  if (action === 'login') {
    const ok = await signIn(Astro.cookies, String(form.get('password') ?? ''));
    return { signedIn: ok, back, response: ok ? Astro.redirect(path, 303) : back('bad-password') };
  }
  if (!signedIn) return { signedIn, back, response: Astro.redirect(path, 303) };
  if (action === 'logout') {
    signOut(Astro.cookies);
    return { signedIn: false, back, response: Astro.redirect('/studio', 303) };
  }
  return { signedIn, back, form, action };
}

/* Reading form fields ---------------------------------------------- */

export const text = (form: FormData, name: string, max = 200) =>
  String(form.get(name) ?? '')
    .trim()
    .slice(0, max);

/** An optional field: undefined when blank. */
export const optional = (form: FormData, name: string, max = 200) => text(form, name, max) || undefined;
