import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './I18nProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { registerOfflineWorker } from './lib/serviceWorker';
import { configureSearchWorker } from './lib/searchIndex';
import 'highlight.js/styles/github-dark.css';
import './styles.css';

configureSearchWorker(() => new Worker(new URL('./workers/search.worker.ts', import.meta.url), { type: 'module' }));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void registerOfflineWorker(import.meta.env.BASE_URL);
  });
}
