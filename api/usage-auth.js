import { createHash } from 'node:crypto';

async function verifyAnonymousKey(key) {
  if (!key || key.length > 512) return null;

  // The key is a stable installation identifier, not proof of a paid plan.
  return createHash('sha256').update(key).digest('hex');
}

export async function verifyUsageReservation(req) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const key = String(req.headers['x-snip-extensionpay-key'] || '');
  const id = String(req.body?.reservation_id || '');

  if (!url || !anon || !service) throw new Error('Supabase configuration missing');

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, status: 400, error: 'A valid usage reservation is required.' };
  }

  let table;
  let ownerFilter;

  if (token) {
    const auth = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000)
    });

    if (!auth.ok) return { ok: false, status: 401, error: 'Invalid session.' };

    const user = await auth.json();
    if (!user.id) return { ok: false, status: 401, error: 'Account verification failed.' };

    table = 'snip_usage_reservations';
    ownerFilter = { user_id: `eq.${user.id}` };
  } else {
    const installHash = await verifyAnonymousKey(key);
    if (!installHash) {
      return { ok: false, status: 401, error: 'A verified Free installation is required.' };
    }

    table = 'snip_anonymous_usage_reservations';
    ownerFilter = { install_hash: `eq.${installHash}` };
  }

  const params = new URLSearchParams({
    id: `eq.${id}`,
    ...ownerFilter,
    status: 'eq.reserved',
    expires_at: `gt.${new Date().toISOString()}`,
    select: 'id'
  });

  const check = await fetch(`${url}/rest/v1/${table}?${params}`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
    signal: AbortSignal.timeout(10000)
  });

  if (!check.ok) throw new Error('Reservation verification failed');

  const rows = await check.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    return { ok: false, status: 403, error: 'Reservation invalid or expired.' };
  }

  return { ok: true, reservationId: id };
}
