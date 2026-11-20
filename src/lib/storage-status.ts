/** Is file storage set up (resumes, documents, training videos)? Names the settings, never their values. */
export function storageStatus(env: Record<string, string | undefined> = process.env) {
  if (env.STORAGE_DRIVER === 'local') return { ok: env.NODE_ENV !== 'production', summary: env.NODE_ENV === 'production' ? 'STORAGE_DRIVER is “local”, which keeps files on the server’s own disk. On Vercel that disk is wiped, so uploads disappear. Remove STORAGE_DRIVER and set the S3 settings.' : 'Files are kept on this computer’s disk (development).' };
  const missing = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !env[k]?.trim() || /^\.\.\.$/.test(env[k]!.trim()));
  if (missing.length) return { ok: false, missing, summary: `File storage isn’t set up: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing, so uploads (resumes, documents, training videos) fail. Add ${missing.length === 1 ? 'it' : 'them'} in Vercel → Settings → Environment Variables (Production) and redeploy.` };
  return { ok: true, missing: [], summary: `File storage is set up (bucket ${env.S3_BUCKET}${env.S3_ENDPOINT ? ` at ${new URL(env.S3_ENDPOINT).hostname}` : `, AWS ${env.S3_REGION}`}). Training videos upload straight from the browser to the bucket, so its CORS rules must allow PUT from the site (see README “Training videos”).` };
}
