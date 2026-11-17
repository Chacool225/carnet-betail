import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* l'appli marche sans */ }); });
}
