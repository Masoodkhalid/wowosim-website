import type { APIRoute } from 'astro';
import { portalFetch } from '../../lib/api';

export const GET: APIRoute = async ({ url }) => {
  const iso3 = url.searchParams.get('iso3') ?? 'USA';
  const res = await portalFetch(`/plans?q[iso3_eq]=${iso3}`);
  if (!res.ok) return new Response(JSON.stringify([]), { status: 200 });
  const data = await res.json();
  return new Response(JSON.stringify(data.plans ?? []), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
};
