import type { MetadataRoute } from 'next';

/** Lets people add Preciops to their phone's home screen and open it full screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Preciops ATMS', short_name: 'Preciops', description: 'Recruiting, CRM, timesheets and e-signatures for staffing firms.',
    start_url: '/app', scope: '/', display: 'standalone', orientation: 'any', background_color: '#152238', theme_color: '#152238',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Pipeline', url: '/app/pipeline' }, { name: 'Candidates', url: '/app/candidates' },
      { name: 'Timesheets', url: '/app/timesheets' }, { name: 'Tasks', url: '/app/tasks' },
    ],
  };
}
