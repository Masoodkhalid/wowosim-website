import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

function extractRedirectUrl(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const url =
    data.redirect_url   ?? data.url            ?? data.checkout_url ??
    data.payment_url    ?? data.stripe_url      ?? data.session_url  ??
    data.payment_link   ?? data.link           ?? data.hosted_url   ??
    data.invoice_url    ?? data.checkout_link  ?? null;
  return url && typeof url === 'string' && url.startsWith('http') ? url : null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const jwt = getJwt(cookies);
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Please sign in to complete your purchase.' }), { status: 401 });
  }

  const body = await request.json();
  const cartItems: any[] = body.line_items ?? [];

  if (cartItems.length === 0) {
    return new Response(JSON.stringify({ error: 'Your cart is empty.' }), { status: 400 });
  }

  // ── Raw items (passed straight through, matching the working PHP checkout) ──
  // PHP: json_encode(["line_items" => json_decode(stripslashes($_COOKIE['wordpress_cart']))])
  // Cart items already contain: id, system_id, name, country, flag, quota, valadity, price_usd, price, quantity
  const rawLineItems = cartItems;

  // ── Mapped variants in case the portal uses different field names ──
  const line_items = cartItems.map((item: any) => ({
    plan_id:   item.id ?? item.plan_id ?? item.system_id,
    system_id: item.system_id ?? item.id,
    id:        item.id ?? item.plan_id ?? item.system_id,
    quantity:  item.quantity ?? 1,
    price_usd: item.price_usd ?? item.price ?? 0,
    name:      item.name ?? '',
  }));

  const items = cartItems.map((item: any) => ({
    id:        item.id ?? item.plan_id ?? item.system_id,
    quantity:  item.quantity ?? 1,
    price:     item.price_usd ?? item.price ?? 0,
    name:      item.name ?? '',
  }));

  // Try every realistic endpoint + payload combination.
  // FIRST: raw items (exactly as PHP does it) — most likely to work.
  const attempts = [
    { path: '/checkout',          payload: { line_items: rawLineItems } },  // ← matches PHP exactly
    { path: '/checkout',          payload: { line_items } },
    { path: '/checkout',          payload: { items } },
    { path: '/orders',            payload: { line_items: rawLineItems } },
    { path: '/orders',            payload: { line_items } },
    { path: '/orders',            payload: { items } },
    { path: '/stripe/checkout',   payload: { line_items: rawLineItems } },
    { path: '/stripe/checkout',   payload: { line_items } },
    { path: '/checkout_session',  payload: { line_items: rawLineItems } },
    { path: '/payments',          payload: { line_items: rawLineItems } },
    { path: '/stripe/session',    payload: { line_items: rawLineItems } },
  ];

  const debugLog: Record<string, any> = {};

  for (const { path, payload } of attempts) {
    const key = `${path}|${JSON.stringify(Object.keys(payload))}`;
    if (debugLog[key]) continue; // skip duplicate combinations

    try {
      const res = await portalFetch(path, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, jwt);

      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      debugLog[key] = { status: res.status, body: data };

      if (res.ok) {
        const redirectUrl = extractRedirectUrl(data);
        if (redirectUrl) {
          return new Response(JSON.stringify({ redirect_url: redirectUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // Got 200 but no URL — stop trying, return this response for debug
        return new Response(JSON.stringify({
          error: `Payment gateway responded but did not return a checkout URL. Portal said: ${data.message ?? data.error ?? JSON.stringify(data).slice(0, 200)}`,
          debug: { path, response: data },
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      // 401 = auth failed — stop immediately
      if (res.status === 401 || res.status === 403) {
        return new Response(JSON.stringify({
          error: 'Session expired. Please log out and log back in.',
          debug: debugLog,
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    } catch { /* network error on this attempt — try next */ }
  }

  return new Response(JSON.stringify({
    error: 'Could not connect to payment gateway. Please try again or contact support.',
    debug: debugLog,
  }), { status: 502, headers: { 'Content-Type': 'application/json' } });
};
