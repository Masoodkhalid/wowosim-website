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

  // Stripe Checkout Session format — confirmed from Rails console (Morocco $9.00 succeeded):
  // price_data.unit_amount in cents, metadata under product_data
  const payload = {
    line_items: cartItems.map((item: any) => {
      const unitAmount = Math.round(parseFloat(String(item.price_usd ?? item.price ?? 0)) * 100);
      const isTopup    = !!item.is_topup;
      return {
        price_data: {
          currency:     'usd',
          unit_amount:  unitAmount,
          product_data: {
            name: item.name ?? 'WoWo SIM eSIM',
            metadata: {
              vendor_plan_id: isTopup ? (item.topup_id ?? item.system_id) : (item.system_id ?? item.id),
              generate_esim:  isTopup ? 0 : 1,
              esim_iccid:     isTopup ? (item.iccid ?? '') : '',
            },
          },
        },
        quantity: item.quantity ?? 1,
      };
    }),
  };

  const paths = ['/payment-intent'];

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

      // 422 — check if it's a Stripe minimum amount error
      if (res.status === 422) {
        const errMsg: string = data?.error ?? '';
        const isMinimum = errMsg.includes('minimum charge amount');
        return new Response(JSON.stringify({
          error: isMinimum
            ? 'This plan\'s price is below the minimum charge amount. Please choose a plan with a higher price or add more plans to your cart.'
            : `Payment error: ${errMsg || JSON.stringify(data)}`,
          debug: debugLog,
        }), { status: 422, headers: { 'Content-Type': 'application/json' } });
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
