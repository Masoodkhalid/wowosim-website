import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

export const GET: APIRoute = async ({ request, cookies }) => {
  const jwt = getJwt(cookies);
  if (!jwt) return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401 });

  const url  = new URL(request.url);
  const iccid = url.searchParams.get('iccid') ?? '';

  // ── Step 1: /esims list — KNOWN to work, has quota/valadity/state/country ──
  let listEsim: any = null;
  try {
    const r = await portalFetch('/esims', {}, jwt);
    if (r.ok) {
      const d = await r.json();
      const list: any[] = d.esims ?? d.data ?? (Array.isArray(d) ? d : []);
      listEsim = list.find((e: any) => String(e.iccid) === String(iccid)) ?? null;
    }
  } catch {}

  // ── Step 2: /esim/{iccid} — for QR code + data_plans ──
  let detailEsim: any = null;
  try {
    const r = await portalFetch(`/esim/${iccid}`, {}, jwt);
    if (r.ok) {
      const d = await r.json();
      const candidate = d.esim ?? d;
      if (candidate && !candidate.error) detailEsim = candidate;
    }
  } catch {}

  // Merge: list fields first (reliable), detail fields on top
  const esim: any = { ...(listEsim ?? {}), ...(detailEsim ?? {}) };

  if (!listEsim && !detailEsim) {
    return new Response(JSON.stringify({
      error: 'eSIM not found. Make sure you are logged in.',
      iccid,
    }), { status: 404 });
  }

  // ── data_plans from detail endpoint ──
  const plans: any[] = esim.data_plans ?? esim.plans ?? esim.bundles ?? [];

  // Aggregate bytes: data_quota_bytes, data_bytes_remaining (real DB fields)
  let totalBytes = 0, remainingBytes = 0;
  for (const p of plans) {
    const q = Number(p.data_quota_bytes ?? 0);
    const rem = Number(p.data_bytes_remaining ?? q); // default = full quota (unused)
    totalBytes     += q;
    remainingBytes += rem;
  }
  const usedBytes = Math.max(0, totalBytes - remainingBytes);

  // Active plan
  const activePlan = plans.find((p: any) => (p.network_status ?? p.status) === 'ACTIVE') ?? plans[0] ?? null;

  // Quota: vendor_quota (GB) from active plan, fallback to esim.quota from list
  const quotaGB: number =
    Number(activePlan?.vendor_quota) ||
    Number(esim.quota) ||
    (totalBytes > 0 ? totalBytes / 1_073_741_824 : 0);

  // Validity: vendor_valadity from plan, fallback to esim.valadity from list
  const validity: number =
    Number(activePlan?.vendor_valadity) ||
    Number(esim.valadity ?? esim.validity) || 0;

  const quotaDisplay = quotaGB > 0 ? `${quotaGB % 1 === 0 ? quotaGB : quotaGB.toFixed(1)} GB` : null;

  // State — list has: ENABLED, RELEASED, DISABLED, deleted
  const state = String(esim.state ?? esim.status ?? 'UNKNOWN').toUpperCase();

  // QR + manual codes
  const qrUrl          = esim.qr_code_url ?? esim.qr_code ?? esim.qrcode ?? esim.qr ?? null;
  const activationCode = esim.activation_code ?? esim.manual_code ?? esim.lpa ?? null;
  const smDpAddress    = esim.sm_dp_plus_address ?? esim.sm_dp_address ?? esim.smdp ?? null;

  // Plan rows for Data Plans section + topup eligibility check
  const planRows = plans.map((p: any) => ({
    id:              p.id,
    name:            p.vendor_plan_name ?? p.name ?? 'Data Plan',
    // network_status raw string (PHP checks: != 'NOT_ACTIVE')
    network_status:  String(p.network_status ?? p.status ?? ''),
    status:          String(p.network_status ?? p.status ?? '').toUpperCase(),
    country:         p.countries_enabled ?? p.country ?? esim.country ?? null,
    quota_bytes:     Number(p.data_quota_bytes ?? 0),
    remaining_bytes: Number(p.data_bytes_remaining ?? p.data_quota_bytes ?? 0),
    quota_gb:        Number(p.vendor_quota) || null,
    // vendor_valadity raw (PHP checks: != 1)
    validity_days:   p.vendor_valadity != null ? Number(p.vendor_valadity) : (Number(p.validity) || null),
    start_time:      p.start_time ?? p.date_activated ?? null,
    created_at:      p.created_at ?? null,
    end_time:        p.end_time ?? null,
    price:           p.vendor_price ?? null,
  }));

  return new Response(JSON.stringify({
    iccid:           String(esim.iccid ?? iccid),
    state,
    country:         esim.country ?? esim.country_name ?? esim.name ?? null,
    network:         esim.network ?? esim.carrier ?? null,
    speed:           esim.speed ?? null,
    quota:           quotaDisplay,
    quota_gb:        quotaGB,
    validity,
    qr_url:          qrUrl,
    activation_code: activationCode,
    sm_dp_address:   smDpAddress,
    plan_name:       activePlan?.vendor_plan_name ?? esim.plan_name ?? null,
    coverage:        esim.coverage ?? esim.country ?? null,
    hotspot:         esim.hotspot ?? null,
    plan_rows:       planRows,
    total_bytes:     totalBytes,
    used_bytes:      usedBytes,
    remaining_bytes: remainingBytes,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
