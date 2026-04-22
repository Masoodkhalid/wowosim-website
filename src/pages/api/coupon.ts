import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

// Known promo codes with discounts (fallback if no API endpoint)
const PROMO_CODES: Record<string, { discount: number; type: 'percent' | 'fixed'; label: string }> = {
  'APRIL10':   { discount: 10, type: 'percent', label: '10% off April Sale' },
  'WELCOME10': { discount: 10, type: 'percent', label: '10% off Welcome Offer' },
  'TRAVEL5':   { discount: 5,  type: 'fixed',   label: '$5 off Travel Discount' },
  'FIRST15':   { discount: 15, type: 'percent', label: '15% off First Order' },
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const { code, subtotal } = await request.json();
  const jwt = getJwt(cookies);
  const upperCode = (code ?? '').toUpperCase().trim();

  // Try portal API first
  try {
    const res = await portalFetch('/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ code: upperCode }),
    }, jwt ?? undefined);
    if (res.ok) {
      const data = await res.json();
      if (data.valid || data.discount) {
        return new Response(JSON.stringify({
          valid: true,
          code: upperCode,
          discount: data.discount ?? data.amount ?? 0,
          type: data.type ?? 'percent',
          label: data.description ?? `${data.discount}% off`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
  } catch {}

  // Fallback to local promo codes
  const promo = PROMO_CODES[upperCode];
  if (promo) {
    const discountAmount = promo.type === 'percent'
      ? ((subtotal ?? 0) * promo.discount / 100)
      : promo.discount;
    return new Response(JSON.stringify({
      valid: true,
      code: upperCode,
      discount: promo.discount,
      discountAmount: Math.round(discountAmount * 100) / 100,
      type: promo.type,
      label: promo.label,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ valid: false, message: 'Promo code not found or expired.' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
