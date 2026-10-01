export async function forEachWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const width = Math.max(1, Math.min(list.length, Math.floor(Number(limit) || 1)));
  let next = 0;

  async function run() {
    while (true) {
      const index = next++;
      if (index >= list.length) return;
      await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: width }, () => run()));
}

export async function closeStaleRows(rows, limit, updateSession, durationSeconds) {
  await forEachWithConcurrency(rows, limit, async session => {
    await updateSession(session.id, {
      ended_at: session.last_activity_at,
      duration_seconds: durationSeconds(session.started_at, session.last_activity_at),
      end_reason: 'inactivity',
    });
  });
}
