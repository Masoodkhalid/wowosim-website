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

  // Try singular endpoint first (confirmed to exist)
  for (const ep of [`/esim/${iccid}`, `/esims/${iccid}`, `/esims?iccid=${iccid}`, `/esims?q[iccid_eq]=${iccid}`]) {
    try {
      const res = await portalFetch(ep, {}, jwt);
      if (res.ok) {
        const d = await res.json();
        const candidate = d.esim ?? d.data ?? (Array.isArray(d) ? d.find((e: any) => e.iccid === iccid) ?? d[0] : null) ?? d;
        if (candidate && typeof candidate === 'object' && Object.keys(candidate).length > 2) {
          esim = candidate;
          break;
        }
      }
    } catch {}
  }

  // If still nothing, try fetching the whole list and matching
  if (!esim) {
    try {
      const res = await portalFetch('/esims', {}, jwt);
      if (res.ok) {
        const d = await res.json();
        const list: any[] = d.esims ?? d.data ?? (Array.isArray(d) ? d : []);
        esim = list.find((e: any) => e.iccid === iccid || e.eid === iccid) ?? null;
      }
    } catch {}
  }

  if (!esim) {
    return new Response(JSON.stringify({ error: 'eSIM not found', iccid }), { status: 404 });
  }

  // Normalize fields to a consistent shape the frontend can rely on
  const qrUrl = esim.qr_code_url ?? esim.qr_code ?? esim.qrcode ?? esim.qr_url
             ?? esim.lpa_code ?? esim.lpa_string ?? esim.qr_image ?? esim.qr
             ?? esim.activation_qr ?? null;

  const manualCode = esim.manual_code ?? esim.activation_code ?? esim.lpa
                  ?? esim.sm_dp_address ?? esim.smdp ?? esim.smdp_address
                  ?? esim.lpa_string ?? null;

  const rawQuota = esim.quota ?? esim.data ?? esim.data_gb ?? esim.total_data;
  const quota = rawQuota != null ? (typeof rawQuota === 'number' ? `${rawQuota} GB` : String(rawQuota)) : null;

  const validity = esim.valadity ?? esim.validity ?? esim.duration ?? esim.duration_days ?? esim.days ?? null;

  // Data usage
  const plans: any[] = esim.plans ?? esim.bundles ?? esim.packages ?? esim.subscriptions ?? [];
  const totalBytes = plans.reduce((s: number, p: any) => s + (p.data_quota_bytes ?? p.data_bytes ?? p.total_bytes ?? 0), 0);
  const usedBytes  = plans.reduce((s: number, p: any) => s + (p.data_usage_bytes ?? p.used_bytes ?? p.usage_bytes ?? 0), 0);

  // Top-level usage fields (some portals put usage here)
  const topTotalBytes = esim.data_quota_bytes ?? esim.total_bytes ?? esim.data_bytes ?? 0;
  const topUsedBytes  = esim.data_usage_bytes ?? esim.used_bytes  ?? esim.usage_bytes ?? 0;

  const effectiveTotalBytes = totalBytes > 0 ? totalBytes : topTotalBytes;
  const effectiveUsedBytes  = usedBytes  > 0 ? usedBytes  : topUsedBytes;

  return new Response(JSON.stringify({
    // raw fields for debugging
    _raw: esim,
    // normalized
    iccid:       esim.iccid ?? iccid,
    state:       esim.state ?? esim.status ?? 'UNKNOWN',
    country:     esim.country ?? esim.country_name ?? esim.name ?? null,
    network:     esim.network ?? esim.carrier ?? esim.network_type ?? null,
    speed:       esim.speed ?? esim.network_speed ?? null,
    quota,
    validity,
    qr_url:      qrUrl,
    manual_code: manualCode,
    matching_id: esim.confirmation_code ?? esim.matching_id ?? null,
    plan_name:   esim.plan_name ?? esim.name ?? null,
    coverage:    esim.coverage ?? esim.country ?? null,
    hotspot:     esim.hotspot ?? null,
    auto_renew:  esim.auto_renew ?? false,
    plans,
    total_bytes: effectiveTotalBytes,
    used_bytes:  effectiveUsedBytes,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
