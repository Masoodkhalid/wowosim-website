const PORTAL = 'https://portal.wowosim.com/api';

export async function portalFetch(
  path: string,
  options: RequestInit = {},
  jwt?: string | null
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(jwt ? { authorization: jwt } : {}),
  };

  return fetch(`${PORTAL}${path}`, { ...options, headers });
}
