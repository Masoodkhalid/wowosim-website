import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

/** Extract a Stripe-hosted redirect URL from any portal response shape */
function extractRedirectUrl(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const url =
    data.redirect_url   ?? data.url            ?? data.checkout_url ??
    data.payment_url    ?? data.stripe_url      ?? data.session_url  ??
    data.payment_link   ?? data.link           ?? data.hosted_url   ??
    data.invoice_url    ?? data.checkout_link  ?? null;
  return url && typeof url === 'string' && url.startsWith('http') ? url : null;
}

/** Extract a Stripe PaymentIntent client_secret from any portal response shape */
function extractClientSecret(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const cs =
    data.client_secret              ??
    data.payment_intent_client_secret ??
    data.payment_intent?.client_secret ??
    data.stripe?.client_secret      ??
    data.stripe_client_secret       ?? null;
  return cs && typeof cs === 'string' && cs.includes('_secret_') ? cs : null;
}

/** Extract the Stripe publishable key if the portal returns it */
function extractPublishableKey(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const key =
    data.publishable_key ??
    data.stripe_key      ??
    data.public_key      ??
    data.stripe?.publishable_key ?? null;
  return key && typeof key === 'string' && key.startsWith('pk_') ? key : null;
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

  // Raw items — matches working PHP checkout exactly
  const rawLineItems = cartItems;

  // Mapped variants for portal field-name variations
  const line_items = cartItems.map((item: any) => ({
    plan_id:   item.id ?? item.plan_id ?? item.system_id,
    system_id: item.system_id ?? item.id,
    id:        item.id ?? item.plan_id ?? item.system_id,
    quantity:  item.quantity ?? 1,
    price_usd: item.price_usd ?? item.price ?? 0,
    name:      item.name ?? '',
    // topup fields (present only when buying a topup)
    ...(item.topup_id ? { topup_id: item.topup_id } : {}),
    ...(item.iccid    ? { iccid:    item.iccid    } : {}),
  }));

  // PaymentIntent path comes FIRST — portal confirmed to use this endpoint
  const attempts = [
    { path: '/payment_intent',       payload: { line_items: rawLineItems } },
    { path: '/payment_intent',       payload: { line_items } },
    { path: '/stripe/payment_intent',payload: { line_items: rawLineItems } },
    { path: '/checkout',             payload: { line_items: rawLineItems } },  // PHP-matching
    { path: '/checkout',             payload: { line_items } },
    { path: '/orders',               payload: { line_items: rawLineItems } },
    { path: '/orders',               payload: { line_items } },
    { path: '/stripe/checkout',      payload: { line_items: rawLineItems } },
    { path: '/checkout_session',     payload: { line_items: rawLineItems } },
    { path: '/payments',             payload: { line_items: rawLineItems } },
  ];

  const debugLog: Record<string, any> = {};

  for (const { path, payload } of attempts) {
    const key = `${path}|${JSON.stringify(Object.keys(payload))}`;
    if (debugLog[key]) continue;

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
        // ── PaymentIntent flow: portal returns client_secret ──
        const clientSecret = extractClientSecret(data);
        if (clientSecret) {
          const publishableKey = extractPublishableKey(data) ?? null;
          return new Response(JSON.stringify({
            client_secret:    clientSecret,
            publishable_key:  publishableKey,
            payment_intent_id: data.id ?? data.payment_intent_id ?? null,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // ── Checkout Session flow: portal returns a redirect URL ──
        const redirectUrl = extractRedirectUrl(data);
        if (redirectUrl) {
          return new Response(JSON.stringify({ redirect_url: redirectUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Got 200 but neither — return for debug
        return new Response(JSON.stringify({
          error: `Portal responded 200 but returned no checkout URL or client_secret. Response: ${data.message ?? data.error ?? JSON.stringify(data).slice(0, 300)}`,
          debug: { path, response: data },
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      if (res.status === 401 || res.status === 403) {
        return new Response(JSON.stringify({
          error: 'Session expired. Please log out and log back in.',
          debug: debugLog,
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    } catch { /* network error — try next */ }
  }

  return new Response(JSON.stringify({
    error: 'Could not connect to payment gateway. Please try again or contact support.',
    debug: debugLog,
  }), { status: 502, headers: { 'Content-Type': 'application/json' } });
};
