import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import path from 'path';
import { defineConfig } from 'vite';

// Build stamp for the version pill in the top bar (same mechanism as Agent-Builder). On
// Cloudflare Pages the commit and branch come from the build environment; locally from git.
// Baked in at build time, so the pill can only describe the bundle it ships inside.
function git(cmd: string): string {
  try { return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim(); } catch { return ''; }
}
const BUILD_SHA = process.env.CF_PAGES_COMMIT_SHA || git('rev-parse HEAD') || 'unknown';
const BUILD_BRANCH = process.env.CF_PAGES_BRANCH || git('rev-parse --abbrev-ref HEAD') || 'unknown';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_BRANCH__: JSON.stringify(BUILD_BRANCH),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_ENV__: JSON.stringify(process.env.CF_PAGES ? 'pages' : 'local'),
  },
});
