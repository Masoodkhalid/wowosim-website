import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const jwt = getJwt(cookies);
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Please sign in to complete your purchase.' }), { status: 401 });
  }

  const body = await request.json();
  const cartItems: any[] = body.line_items ?? [];

  // Map cart items to what portal likely expects
  const line_items = cartItems.map((item: any) => ({
    plan_id:   item.id ?? item.system_id,
    system_id: item.system_id ?? item.id,
    quantity:  item.quantity ?? 1,
    price_usd: item.price_usd ?? item.price,
    name:      item.name,
  }));

  // Try multiple checkout endpoint patterns
  const endpoints = [
    { path: '/checkout',         body: { line_items } },
    { path: '/orders',           body: { line_items } },
    { path: '/stripe/checkout',  body: { line_items } },
    { path: '/payments',         body: { line_items } },
    { path: '/checkout_session', body: { line_items } },
  ];

  const debugLog: Record<string, any> = {};

  for (const ep of endpoints) {
    try {
      const res = await portalFetch(ep.path, {
        method: 'POST',
        body: JSON.stringify(ep.body),
      }, jwt);

      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      debugLog[ep.path] = { status: res.status, body: data };

      if (res.ok && typeof data === 'object') {
        // Check all common redirect URL field names
        const redirectUrl = data.redirect_url ?? data.url ?? data.checkout_url
          ?? data.payment_url ?? data.stripe_url ?? data.session_url
          ?? data.payment_link ?? data.link ?? null;

        if (redirectUrl && typeof redirectUrl === 'string' && redirectUrl.startsWith('http')) {
          return new Response(JSON.stringify({ redirect_url: redirectUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Got 200 but no redirect URL — portal may need different format
        if (res.status === 200) {
          return new Response(JSON.stringify({
            error: 'Payment gateway did not return a checkout URL.',
            debug: data,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
    } catch {}
  }

  return new Response(JSON.stringify({
    error: 'Could not connect to payment gateway. Please try again.',
    debug: debugLog,
  }), { status: 502, headers: { 'Content-Type': 'application/json' } });
};
