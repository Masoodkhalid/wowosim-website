import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

/**
 * GET /api/checkout-probe?system_id=PJ0FB89GA&price=5.50&name=Thailand+3GB/Day
 *
 * Tries every known payload format for /payment-intent and /checkout
 * so we can see which one the portal accepts.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const jwt = getJwt(cookies);
  if (!jwt) return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401 });

  const params     = new URL(request.url).searchParams;
  const system_id  = params.get('system_id') ?? 'PJ0FB89GA';
  const priceFloat = parseFloat(params.get('price') ?? '5.50');
  const priceCents = Math.round(priceFloat * 100);
  const name       = params.get('name') ?? 'Thailand 3GB/Day';

  const formats: Record<string, any> = {
    // A — raw cart item (what our cart stores)
    'raw_cart': {
      line_items: [{
        system_id, name, price_usd: priceFloat, price: priceFloat, quantity: 1,
      }],
    },

    // B — flat with amount in CENTS
    'flat_cents': {
      line_items: [{
        amount: priceCents, currency: 'usd', quantity: 1, description: name,
        metadata: { vendor_plan_id: system_id, generate_esim: 1, esim_iccid: '' },
      }],
    },

    // C — flat with amount in DOLLARS
    'flat_dollars': {
      line_items: [{
        amount: priceFloat, currency: 'usd', quantity: 1, description: name,
        metadata: { vendor_plan_id: system_id, generate_esim: 1, esim_iccid: '' },
      }],
    },

    // D — price_data with unit_amount in CENTS
    'price_data_cents': {
      line_items: [{
        price_data: {
          currency: 'usd', unit_amount: priceCents,
          product_data: {
            name,
            metadata: { vendor_plan_id: system_id, generate_esim: 1, esim_iccid: '' },
          },
        },
        quantity: 1,
      }],
    },

    // E — price_data with unit_amount in DOLLARS
    'price_data_dollars': {
      line_items: [{
        price_data: {
          currency: 'usd', unit_amount: priceFloat,
          product_data: {
            name,
            metadata: { vendor_plan_id: system_id, generate_esim: 1, esim_iccid: '' },
          },
        },
        quantity: 1,
      }],
    },

    // F — just vendor_plan_id + quantity (let portal look up price)
    'plan_id_only': {
      line_items: [{
        vendor_plan_id: system_id, quantity: 1,
      }],
    },
  };

  const results: Record<string, any> = {};

  for (const [label, payload] of Object.entries(formats)) {
    for (const endpoint of ['/payment-intent', '/checkout']) {
      const key = `${label} → ${endpoint}`;
      try {
        const res = await portalFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify(payload),
        }, jwt, 8000);
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
        results[key] = { status: res.status, body };
        // Stop on first success
        if (res.ok) {
          results['🎉 WINNER'] = { format: label, endpoint, body };
          return new Response(JSON.stringify(results, null, 2), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (e: any) {
        results[key] = { error: e?.message ?? 'timeout/network error' };
      }
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
