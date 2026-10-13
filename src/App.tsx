import { lazy, Suspense } from 'react';
import { LandingPage } from './LandingPage';
import { useI18n } from './i18n';

const NoteWorkspace = lazy(() => import('./NoteWorkspace'));

export default function App() {
  const { t } = useI18n();
  const params = new URLSearchParams(window.location.search);
  const openWorkspace = params.get('app') === '1' || window.location.hash === '#app';
  document.documentElement.classList.toggle('marknote-shell', openWorkspace);
  return openWorkspace
    ? <Suspense fallback={<div role="status" className="grid h-screen place-items-center">{t('editor.loadingWorkspace')}</div>}><NoteWorkspace /></Suspense>
    : <LandingPage />;
}
