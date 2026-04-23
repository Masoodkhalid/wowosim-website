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

  // Portal coupon validation endpoint
  try {
    const res = await portalFetch(`/validate_coupon?code=${encodeURIComponent(upperCode)}`, {}, jwt ?? undefined);
    if (res.ok) {
      const data = await res.json();
      // Invalid/expired coupon: { status: "No such coupon exists" } or { out: "..." }
      if (data.status || data.out) {
        return new Response(JSON.stringify({ valid: false, message: data.status ?? data.out }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      // Valid coupon: has id + percentage or fixed_amount
      if (data.id) {
        const isPercent = data.percentage !== null && data.percentage !== undefined;
        const discount = isPercent ? Number(data.percentage) : Number(data.fixed_amount ?? 0);
        const type: 'percent' | 'fixed' = isPercent ? 'percent' : 'fixed';
        const discountAmount = type === 'percent'
          ? Math.round((subtotal ?? 0) * discount / 100 * 100) / 100
          : discount;
        return new Response(JSON.stringify({
          valid: true,
          code: data.code,
          discount,
          discountAmount,
          type,
          label: data.detail ?? (isPercent ? `${discount}% off` : `$${discount} off`),
          countries: data.countries ?? null,
          regions: data.regions ?? null,
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
