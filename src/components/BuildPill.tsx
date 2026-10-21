// Which build am I looking at? The commit + build time are baked into the bundle by
// vite.config.ts, so the pill can only describe the bundle it ships inside. If the pill does
// not show the commit you just pushed, Pages has not deployed it (or the tab is stale — reload).
const SHORT_SHA = __BUILD_SHA__.slice(0, 7);
const REPO_URL = 'https://github.com/torarnehave1/Contacts';

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'nå';
  if (m < 60) return `${m} min siden`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} t siden`;
  return `${Math.round(h / 24)} d siden`;
}

export default function BuildPill() {
  const local = __BUILD_ENV__ === 'local';
  const built = new Date(__BUILD_TIME__);
  const builtLabel = Number.isNaN(built.getTime()) ? __BUILD_TIME__ : built.toLocaleString('nb-NO');
  const title = [
    local ? 'Lokal utviklingsbuild (ikke deployet)' : 'Deployet build',
    `commit ${__BUILD_SHA__}`,
    `branch ${__BUILD_BRANCH__}`,
    `bygget ${builtLabel}${ago(__BUILD_TIME__) ? ` (${ago(__BUILD_TIME__)})` : ''}`,
    'Klikk for å åpne committen på GitHub',
  ].join('\n');
  const tone = local
    ? 'border-amber-500/60 bg-amber-100 text-amber-800 hover:bg-amber-200'
    : 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200';

  return (
    <a
      href={`${REPO_URL}/commit/${__BUILD_SHA__}`}
      target="_blank"
      rel="noreferrer"
      title={title}
      data-build-sha={__BUILD_SHA__}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-normal transition ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${local ? 'bg-amber-400' : 'bg-emerald-400'}`} />
      <span>{local ? `dev ${SHORT_SHA}` : SHORT_SHA}</span>
    </a>
  );
}
