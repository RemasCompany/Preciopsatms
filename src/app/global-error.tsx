'use client';
import ErrorReport from '@/components/ErrorReport';

/** Last-resort error page (the root layout itself failed). */
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}><ErrorReport {...props} /></body></html>;
}
