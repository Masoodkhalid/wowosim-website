import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

export const GET: APIRoute = async ({ request, cookies }) => {
  const jwt = getJwt(cookies);
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const url = new URL(request.url);
  const iccid = url.searchParams.get('iccid') ?? '';

  let esim: any = null;

  // Primary: /esim/{iccid} — confirmed working endpoint
  try {
    const res = await portalFetch(`/esim/${iccid}`, {}, jwt);
    if (res.ok) {
      const d = await res.json();
      // Portal wraps in { esim: {...} } or returns flat
      esim = d.esim ?? d;
    }
  } catch {}

  // Fallback: scan the /esims list
  if (!esim || Object.keys(esim).length < 2) {
    try {
      const res = await portalFetch('/esims', {}, jwt);
      if (res.ok) {
        const d = await res.json();
        const list: any[] = d.esims ?? d.data ?? (Array.isArray(d) ? d : []);
        esim = list.find((e: any) => String(e.iccid) === String(iccid)) ?? null;
      }
    } catch {}
  }

  if (!esim) {
    return new Response(JSON.stringify({ error: 'eSIM not found', iccid }), { status: 404 });
  }

  // ── data_plans — real field name from DB ──
  const plans: any[] = esim.data_plans ?? esim.plans ?? esim.bundles ?? esim.packages ?? [];

  // ── Aggregate bytes across all data_plans ──
  // DB fields: data_quota_bytes, data_bytes_remaining
  // used = data_quota_bytes - data_bytes_remaining
  let totalBytes = 0;
  let remainingBytes = 0;

  for (const p of plans) {
    const quota     = p.data_quota_bytes     ?? p.quota_bytes     ?? p.total_bytes  ?? 0;
    const remaining = p.data_bytes_remaining ?? p.bytes_remaining ?? p.remaining    ?? quota; // default remaining=quota if unused
    totalBytes    += quota;
    remainingBytes += remaining;
  }

  const usedBytes = Math.max(0, totalBytes - remainingBytes);

  // ── Quota / validity from first active plan or vendor fields ──
  const activePlan = plans.find((p: any) => p.network_status === 'ACTIVE') ?? plans[0] ?? null;

  const quotaGB: number | null = activePlan
    ? (activePlan.vendor_quota ?? (activePlan.data_quota_bytes ? activePlan.data_quota_bytes / 1_073_741_824 : null))
    : (esim.quota ?? esim.data_gb ?? null);

  const validity = activePlan
    ? (activePlan.vendor_valadity ?? activePlan.validity ?? activePlan.duration_days ?? null)
    : (esim.valadity ?? esim.validity ?? esim.duration_days ?? null);

  const quotaDisplay = quotaGB != null ? `${Number(quotaGB).toFixed(quotaGB % 1 === 0 ? 0 : 1)} GB` : null;

  // ── QR / manual code ──
  const qrUrl = esim.qr_code_url ?? esim.qr_code ?? esim.qrcode ?? esim.qr_url
             ?? esim.lpa_code ?? esim.lpa ?? esim.qr ?? null;

  const manualCode = esim.manual_code ?? esim.activation_code ?? esim.lpa
                  ?? esim.sm_dp_address ?? esim.smdp ?? null;

  // ── Country / network ──
  const country = esim.country ?? esim.country_name ?? esim.name ?? null;
  const network = esim.network ?? esim.carrier ?? esim.network_type ?? null;
  const speed   = esim.speed   ?? esim.network_speed ?? null;
  const state   = esim.state   ?? esim.status ?? 'UNKNOWN';

  // ── Plan details ──
  const planName = activePlan?.vendor_plan_name ?? esim.plan_name ?? esim.name ?? null;
  const planStatus = activePlan?.network_status ?? null;  // "ACTIVE" | "INACTIVE"

  return new Response(JSON.stringify({
    _raw: { esim, plans },   // keep for debugging
    iccid:        String(esim.iccid ?? iccid),
    state,
    country,
    network,
    speed,
    quota:        quotaDisplay,
    quota_gb:     quotaGB,
    validity,
    qr_url:       qrUrl,
    manual_code:  manualCode,
    matching_id:  esim.confirmation_code ?? esim.matching_id ?? null,
    plan_name:    planName,
    plan_status:  planStatus,
    coverage:     esim.coverage ?? country,
    hotspot:      esim.hotspot ?? null,
    auto_renew:   esim.auto_renew ?? false,
    plans,
    // byte-level usage
    total_bytes:     totalBytes,
    used_bytes:      usedBytes,
    remaining_bytes: remainingBytes,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
