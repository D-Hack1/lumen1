// Owner: Abhinav
// Entry: fonts → the four Lumen pages (Orbit, Stand here, Compare, Slip explorer), routed by URL hash.
// This replaced the previous app shell (App.tsx and its views, which are still in the tree but no longer mounted).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/dm-sans/300.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PagesApp } from './features/pages/PagesApp';

document.body.style.margin = '0';
document.body.style.background = '#0E0D0B';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PagesApp />
    </StrictMode>,
  );
}
void document.fonts.ready.then(() => {
  document.documentElement.dataset.ready = 'true';
});
