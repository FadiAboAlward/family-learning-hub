/** Run one owned QA lifecycle and guarantee cleanup for every prepared run ID. */
export async function runOwnedQaLifecycle({ prepare, validate, run, cleanup }) {
  const prepared = await prepare();
  let primaryError = null;
  let cleanupError = null;

  try {
    validate(prepared);
    await run(prepared);
  } catch (error) {
    primaryError = error;
  } finally {
    if (prepared?.run_id) {
      try {
        await cleanup(prepared.run_id);
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return prepared;
}
