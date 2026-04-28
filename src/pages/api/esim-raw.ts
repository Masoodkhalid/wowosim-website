import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

export const GET: APIRoute = async ({ request, cookies }) => {
  const url   = new URL(request.url);
  const iccid = url.searchParams.get('iccid') ?? '';
  const jwt   = getJwt(cookies);

  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401 });
  }

  const results: Record<string, any> = {};

  // All endpoints to probe — covers core eSIM data + every possible topup path
  const endpoints = [
    // Core eSIM detail (has data_plans / topup plans inside)
    `/esim/${iccid}`,
    `/esims/${iccid}`,

    // Direct topup endpoints
    `/esim/${iccid}/topup`,
    `/esim/${iccid}/topups`,
    `/esim/${iccid}/plans`,
    `/esim/${iccid}/data_plans`,
    `/esim/${iccid}/bundles`,
    `/esim/${iccid}/addons`,

    // Query-param style
    `/topups?iccid=${iccid}`,
    `/topups?esim_iccid=${iccid}`,
    `/plans?iccid=${iccid}`,
    `/data_plans?iccid=${iccid}`,

    // List endpoint — to confirm the eSIM fields
    `/esims?iccid=${iccid}`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await portalFetch(ep, {}, jwt);
      const text = await res.text();
      let body: any;
      try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
      results[ep] = { status: res.status, body };
    } catch (e: any) {
      results[ep] = { error: e?.message ?? 'network error' };
    }
  }

  // ── Also pull the /esims list and find this eSIM's full object ──
  try {
    const r = await portalFetch('/esims', {}, jwt);
    if (r.ok) {
      const d = await r.json();
      const list: any[] = d.esims ?? d.data ?? (Array.isArray(d) ? d : []);
      const match = list.find((e: any) => String(e.iccid) === String(iccid));
      results['[/esims list — matched entry]'] = match ?? '(iccid not found in list)';
    }
  } catch (e: any) {
    results['[/esims list — matched entry]'] = { error: e?.message };
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
