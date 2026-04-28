const PORTAL = 'https://portal.wowosim.com/api';

/**
 * Fetch from the WoWo portal API with an automatic timeout.
 * Default: 12 seconds. Pass timeoutMs = 0 to disable.
 */
export async function portalFetch(
  path: string,
  options: RequestInit = {},
  jwt?: string | null,
  timeoutMs = 12_000
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(jwt ? { authorization: jwt } : {}),
  };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const res = await fetch(`${PORTAL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    return res;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
