import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

/** Pull a payment redirect URL out of any portal response shape */
function extractUrl(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const url =
    data.url             ??
    data.redirect_url    ??
    data.checkout_url    ??
    data.payment_url     ??
    data.stripe_url      ??
    data.payment_link    ??
    data.link            ??
    data.hosted_url      ??
    data.session_url     ??
    data.invoice_url     ??
    data.checkout_link   ?? null;
  return url && typeof url === 'string' && url.startsWith('http') ? url : null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const jwt = getJwt(cookies);
  if (!jwt) {
    return new Response(
      JSON.stringify({ error: 'Please sign in to complete your purchase.' }),
      { status: 401 }
    );
  }

  const body = await request.json();
  const cartItems: any[] = body.line_items ?? [];

  if (cartItems.length === 0) {
    return new Response(JSON.stringify({ error: 'Your cart is empty.' }), { status: 400 });
  }

  // Pass cart items exactly as the PHP portal code does:
  // json_encode(["line_items" => json_decode(stripslashes($_COOKIE['wordpress_cart']))])
  const payload = { line_items: cartItems };

  // Endpoints to try — /payment_intent first (user-confirmed path), then /checkout fallback
  const paths = [
    '/payment_intent',
    '/checkout',
    '/orders',
    '/stripe/payment_intent',
    '/stripe/checkout',
  ];

  const debugLog: Record<string, any> = {};

  for (const path of paths) {
    try {
      const res = await portalFetch(path, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, jwt);

      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      debugLog[path] = { status: res.status, body: data };

      if (res.ok) {
        const url = extractUrl(data);
        if (url) {
          return new Response(JSON.stringify({ url }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // 200 but no URL — log what the portal actually said
        return new Response(JSON.stringify({
          error: `Portal responded but returned no payment URL. Response: ${data.message ?? data.error ?? JSON.stringify(data).slice(0, 300)}`,
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
