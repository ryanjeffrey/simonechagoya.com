/**
 * Etsy Open API v3 client for scripts/import-etsy.mjs: OAuth login, token refresh
 * and paginated reads. Reading sold-out listings needs an OAuth token with the
 * listings_r scope; `npm run import:etsy -- --etsy-login` gets one.
 *
 * Settings come from the environment (or .env):
 *   ETSY_API_KEY        the app's keystring, from etsy.com/developers/your-apps
 *   ETSY_SHARED_SECRET  the app's shared secret. Etsy expects "keystring:secret" in x-api-key.
 *   ETSY_SHOP_NAME      defaults to SimoneChagoyaStudio
 *   ETSY_REDIRECT_URI   defaults to http://localhost:3003/etsy-callback; register it on the app
 *   ETSY_ACCESS_TOKEN   use this token instead of the saved one (no refresh)
 *
 * The token is saved to etsy-export/etsy-token.json, which is gitignored.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_BASE = process.env.ETSY_API_BASE ?? 'https://openapi.etsy.com/v3/application';
const TOKEN_URL = process.env.ETSY_TOKEN_URL ?? 'https://api.etsy.com/v3/public/oauth/token';
const CONNECT_URL = 'https://www.etsy.com/oauth/connect';
const SCOPES = ['listings_r'];
const PAGE = 100;
const TIMEOUT_MS = 30_000;
const RETRIES = 3;

export const DEFAULT_SHOP = 'SimoneChagoyaStudio';
export const REDIRECT_URI = process.env.ETSY_REDIRECT_URI ?? 'http://localhost:3003/etsy-callback';

export class EtsyError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base64url = (buf) => buf.toString('base64url');

function credentials() {
  const key = process.env.ETSY_API_KEY?.trim();
  if (!key) throw new EtsyError('ETSY_API_KEY is not set. Add the app keystring to .env (see README > Importing from Etsy).');
  const secret = process.env.ETSY_SHARED_SECRET?.trim();
  return { key, header: secret ? `${key}:${secret}` : key };
}

/** Host of a URL, for error messages that say which host the network refused. */
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

async function request(url, init = {}) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      lastError = new EtsyError(`could not reach ${hostOf(url)} (${err?.cause?.code ?? err?.message ?? err})`);
      continue;
    }
    if (res.ok) return res.json();
    const body = await res.text().catch(() => '');
    lastError = new EtsyError(`${init.method ?? 'GET'} ${url} answered HTTP ${res.status}: ${body.slice(0, 300)}`);
    if (res.status === 429 || res.status >= 500) continue;
    break;
  }
  throw lastError;
}

// OAuth -------------------------------------------------------------------

async function readToken(file) {
  const text = await readFile(file, 'utf8').catch(() => null);
  return text ? JSON.parse(text) : null;
}

async function saveToken(file, json) {
  const token = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  return token;
}

/**
 * Authorization code flow with PKCE. Prints the Etsy consent URL, waits for the
 * redirect on localhost, trades the code for a token and saves it.
 */
export async function login(tokenFile) {
  const { key } = credentials();
  const redirect = new URL(REDIRECT_URI);
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  const url = new URL(CONNECT_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: key,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  }).toString();

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const got = new URL(req.url, REDIRECT_URI);
      if (got.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const finish = (status, message, result) => {
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(message);
        server.close();
        result();
      };
      if (got.searchParams.get('state') !== state) {
        return finish(400, 'State did not match. Run the login again.', () => reject(new EtsyError('OAuth state did not match')));
      }
      const error = got.searchParams.get('error');
      if (error) return finish(400, `Etsy said: ${error}`, () => reject(new EtsyError(`Etsy refused the login: ${error}`)));
      finish(200, 'Signed in to Etsy. You can close this tab.', () => resolve(got.searchParams.get('code')));
    });
    server.on('error', reject);
    server.listen(Number(redirect.port || 80), redirect.hostname, () => {
      console.log(`Open this URL, sign in as the shop owner and allow access:\n\n  ${url}\n`);
      console.log(`Waiting for Etsy to redirect to ${REDIRECT_URI} ...`);
    });
  });

  const json = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: key, redirect_uri: REDIRECT_URI, code, code_verifier: verifier }),
  });
  await saveToken(tokenFile, json);
  console.log(`Saved the Etsy token to ${tokenFile}. It refreshes itself for 90 days.`);
}

/** A valid access token: ETSY_ACCESS_TOKEN, or the saved one, refreshed when it is about to expire. */
async function accessToken(tokenFile) {
  if (process.env.ETSY_ACCESS_TOKEN) return process.env.ETSY_ACCESS_TOKEN.trim();
  const token = await readToken(tokenFile);
  if (!token) throw new EtsyError('no Etsy token yet. Run: npm run import:etsy -- --etsy-login');
  if (token.expires_at - Date.now() > 60_000) return token.access_token;
  const { key } = credentials();
  const json = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: key, refresh_token: token.refresh_token }),
  }).catch((err) => {
    throw new EtsyError(`refreshing the Etsy token failed, run --etsy-login again (${err.message})`);
  });
  return (await saveToken(tokenFile, json)).access_token;
}

// Reads -------------------------------------------------------------------

export async function createClient(tokenFile) {
  const { header } = credentials();
  const token = await accessToken(tokenFile);
  const headers = { 'x-api-key': header, authorization: `Bearer ${token}`, accept: 'application/json' };

  const get = (route, params = {}) => {
    const url = new URL(`${API_BASE}${route}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    return request(url, { headers });
  };

  /** Every result of a paginated endpoint. */
  async function all(route, params = {}) {
    const results = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await get(route, { ...params, limit: PAGE, offset });
      results.push(...(page.results ?? []));
      if (!page.results?.length || results.length >= (page.count ?? 0)) return results;
    }
  }

  async function shopId(name) {
    if (process.env.ETSY_SHOP_ID) return Number(process.env.ETSY_SHOP_ID);
    const { results = [] } = await get('/shops', { shop_name: name });
    const shop = results.find((s) => s.shop_name?.toLowerCase() === name.toLowerCase());
    if (!shop) throw new EtsyError(`no Etsy shop named ${name}`);
    return shop.shop_id;
  }

  /**
   * Listings in one state ("active", "sold_out") with their images and videos.
   * Falls back to the per-listing endpoints when the includes come back missing.
   */
  async function listings(shop, state) {
    const list = await all(`/shops/${shop}/listings`, { state, includes: 'Images,Videos' });
    for (const listing of list) {
      listing.images ??= (await get(`/listings/${listing.listing_id}/images`)).results ?? [];
      listing.videos ??= (await get(`/listings/${listing.listing_id}/videos`)).results ?? [];
    }
    return list;
  }

  return { shopId, listings };
}
