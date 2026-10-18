/**
 * Sign-in for the orders page (/studio). One shared password, STUDIO_PASSWORD,
 * set in Netlify. The cookie holds an HMAC of a fixed string keyed by the
 * password, so changing the password signs everyone out.
 */
import type { AstroCookies } from 'astro';
import { STUDIO_PASSWORD } from 'astro:env/server';

export const COOKIE = 'studio';

async function sign(password: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode('simonechagoya-studio-v1'));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const studioEnabled = () => Boolean(STUDIO_PASSWORD);

export async function isSignedIn(cookies: AstroCookies) {
  const token = cookies.get(COOKIE)?.value;
  return Boolean(STUDIO_PASSWORD && token && same(token, await sign(STUDIO_PASSWORD)));
}

/** Checks the password and sets the cookie. Wrong guesses are slowed down. */
export async function signIn(cookies: AstroCookies, password: string) {
  if (!STUDIO_PASSWORD) return false;
  const [given, expected] = await Promise.all([sign(password), sign(STUDIO_PASSWORD)]);
  if (!same(given, expected)) {
    await new Promise((r) => setTimeout(r, 1000));
    return false;
  }
  cookies.set(COOKIE, expected, { path: '/studio', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 60 * 60 * 24 * 60 });
  return true;
}

export const signOut = (cookies: AstroCookies) => cookies.delete(COOKIE, { path: '/studio' });
