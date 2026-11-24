// The three typefaces, bundled with the app so every screen draws in them (Main board, "Type"):
// Space Grotesk for the names of things, Inter for everything read, JetBrains Mono for what a
// device sends. Only the weights the styles use. The files are served from the app itself, so
// the pages' `default-src 'self'` covers them (electron.vite.config.ts keeps them files).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
