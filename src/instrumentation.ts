/** Runs once when the server starts: report missing configuration in the logs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { configReport } = await import('./lib/config-check');
  const { errors, warnings } = configReport();
  for (const e of errors) console.error(`[config] ${e}`);
  for (const w of warnings) console.warn(`[config] ${w}`);
  if (!errors.length && !warnings.length) console.log('[config] All integrations configured.');
}
