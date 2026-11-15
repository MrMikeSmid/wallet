// Startpunt van de app.
import './styles/app.css';
import './ui/screens/onboarding.ts';
import './ui/screens/home.ts';
import './ui/screens/receive.ts';
import './ui/screens/send.ts';
import './ui/screens/settings.ts';
import { isNative } from './app/storage.ts';
import { start } from './ui/app.ts';

start();

// Offline werken als PWA (niet nodig in de Capacitor-app).
if (import.meta.env.PROD && !isNative() && 'serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
