export async function verifyUsageReservation(req) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const id = String(req.body?.reservation_id || '');

  if (!url || !anon || !service) throw new Error('Supabase configuration missing');
  if (!token || !/^[0-9a-f-]{36}$/i.test(id))
    return { ok: false, status: 401, error: 'Sign-in and reservation required.' };

  const auth = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!auth.ok) return { ok: false, status: 401, error: 'Invalid session.' };
  const user = await auth.json();
  if (!user.id) return { ok: false, status: 401, error: 'Account verification failed.' };

  const params = new URLSearchParams({
    id: `eq.${id}`, user_id: `eq.${user.id}`,
    status: 'eq.reserved', expires_at: `gt.${new Date().toISOString()}`,
    select: 'id'
  });
  const check = await fetch(`${url}/rest/v1/snip_usage_reservations?${params}`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!check.ok) throw new Error('Reservation verification failed');
  const rows = await check.json();
  if (!Array.isArray(rows) || rows.length !== 1)
    return { ok: false, status: 403, error: 'Reservation invalid or expired.' };

  return { ok: true, userId: user.id, reservationId: id };
}
