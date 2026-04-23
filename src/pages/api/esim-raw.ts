import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';
import { getJwt } from '../../lib/auth';

export const GET: APIRoute = async ({ request, cookies }) => {
  const url = new URL(request.url);
  const iccid = url.searchParams.get('iccid') ?? '';
  const jwt = getJwt(cookies);

  const results: Record<string, any> = {};

  const endpoints = [
    `/esims/${iccid}`,
    `/esim/${iccid}`,
    `/esims?q[iccid_eq]=${iccid}`,
    `/esims?iccid=${iccid}`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await portalFetch(ep, {}, jwt);
      const text = await res.text();
      try {
        results[ep] = { status: res.status, body: JSON.parse(text) };
      } catch {
        results[ep] = { status: res.status, body: text.slice(0, 300) };
      }
    } catch (e: any) {
      results[ep] = { error: e?.message };
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
