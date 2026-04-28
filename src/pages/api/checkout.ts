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

  // Log raw cart items to debug price field
  console.log('[WoWo] Raw cart items:', JSON.stringify(cartItems));

  // Transform cart items to the exact format the portal passes to Stripe:
  // { amount (cents), currency, quantity, description, metadata: { vendor_plan_id, generate_esim, esim_iccid } }
  const payload = {
    line_items: cartItems.map((item: any) => {
      const rawPrice    = item.price_usd ?? item.price ?? item.price_regular ?? 0;
      const amountCents = Math.round(parseFloat(String(rawPrice)) * 100);
      const isTopup     = !!item.is_topup;
      console.log(`[WoWo] Item "${item.name}": price_usd=${item.price_usd} price=${item.price} → rawPrice=${rawPrice} → cents=${amountCents}`);
      return {
        amount:      amountCents,
        currency:    'usd',
        quantity:    item.quantity ?? 1,
        description: item.name ?? item.description ?? 'WoWo SIM eSIM',
        metadata: {
          vendor_plan_id: isTopup ? (item.topup_id ?? item.system_id) : (item.system_id ?? item.id),
          generate_esim:  isTopup ? 0 : 1,
          esim_iccid:     isTopup ? (item.iccid ?? '') : '',
        },
      };
    }),
  };
  console.log('[WoWo] Payload to portal:', JSON.stringify(payload));

  const paths = [
    '/payment-intent',
    '/checkout',
    '/orders',
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
      console.log(`[WoWo portal] ${path} → ${res.status}`, JSON.stringify(data).slice(0, 400));

      if (res.status === 401 || res.status === 403) {
        return new Response(JSON.stringify({
          error: 'Session expired. Please log out and log back in.',
          debug: debugLog,
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      if (res.ok) {
        const url = extractUrl(data);
        if (url) {
          console.log(`[WoWo portal] Got payment URL from ${path}:`, url);
          return new Response(JSON.stringify({ url }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // 200 but no URL — show exactly what the portal said
        return new Response(JSON.stringify({
          error: `Portal 200 but no payment URL. Response: ${JSON.stringify(data)}`,
          debug: debugLog,
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      // Non-200: surface the error body prominently and stop (don't try next path for 422)
      if (res.status === 422) {
        return new Response(JSON.stringify({
          error: `Portal validation error (422): ${JSON.stringify(data)}`,
          payload_sent: payload,
          debug: debugLog,
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      // Other non-200 — log and try next path
    } catch (e: any) {
      debugLog[path] = { error: e?.message ?? String(e) };
      console.error(`[WoWo portal] ${path} threw:`, e?.message);
    }
  }

  return new Response(JSON.stringify({
    error: 'Payment gateway did not return a payment link. See debug for details.',
    debug: debugLog,
  }), { status: 502, headers: { 'Content-Type': 'application/json' } });
};
