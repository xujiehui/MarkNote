import type { ReactNode } from 'react';
import {
  ArrowRight,
  Braces,
  Check,
  Cloud,
  Download,
  FileDown,
  FolderOpen,
  HardDrive,
  History,
  Image,
  Laptop,
  ListChecks,
  Lock,
  MonitorDown,
  Search,
  SearchCheck,
  Sparkles,
  Tags,
} from 'lucide-react';
import { LanguageSwitch } from './components/LanguageSwitch';
import { useI18n } from './i18n';

const appHref = `${import.meta.env.BASE_URL}?app=1`;
const repoHref = 'https://github.com/xujiehui/MarkNote';
const actionsHref = 'https://github.com/xujiehui/MarkNote/actions/workflows/desktop-build.yml';

const featureKeys = [
  { icon: HardDrive, titleKey: 'landing.featureLocalTitle', descriptionKey: 'landing.featureLocalDesc' },
  { icon: Cloud, titleKey: 'landing.featureSyncTitle', descriptionKey: 'landing.featureSyncDesc' },
  { icon: FolderOpen, titleKey: 'landing.featureOrganizeTitle', descriptionKey: 'landing.featureOrganizeDesc' },
  { icon: Image, titleKey: 'landing.featureEditorTitle', descriptionKey: 'landing.featureEditorDesc' },
  { icon: History, titleKey: 'landing.featureHistoryTitle', descriptionKey: 'landing.featureHistoryDesc' },
  { icon: FileDown, titleKey: 'landing.featureExportTitle', descriptionKey: 'landing.featureExportDesc' },
];

const workflowKeys = ['landing.workflowOrganize', 'landing.workflowWrite', 'landing.workflowSync'];
const heroStatKeys = [
  ['landing.heroStatLocalValue', 'landing.heroStatLocalLabel'],
  ['landing.heroStatSyncValue', 'landing.heroStatSyncLabel'],
  ['landing.heroStatDesktopValue', 'landing.heroStatDesktopLabel'],
];
const syncProofKeys = [
  { icon: Lock, titleKey: 'landing.syncProofLocalTitle', descriptionKey: 'landing.syncProofLocalDesc' },
  { icon: Cloud, titleKey: 'landing.syncProofAccountTitle', descriptionKey: 'landing.syncProofAccountDesc' },
  { icon: SearchCheck, titleKey: 'landing.syncProofDiagnoseTitle', descriptionKey: 'landing.syncProofDiagnoseDesc' },
];
const privacyKeys = [
  'landing.privacyLocalDefault',
  'landing.privacyOAuthOptional',
  'landing.privacyBackups',
  'landing.privacyDiagnostics',
];

export function LandingPage() {
  const { t } = useI18n();

  return (
    <main className="w-full overflow-x-hidden bg-[#f9faf8] text-ink">
      <section className="relative min-h-[92dvh] overflow-hidden border-b border-stone-300/70 bg-[#eef1ed]">
        <div className="absolute inset-x-0 top-0 h-px bg-white/80" />
        <ProductPreview hero />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(238,241,237,0.98)_0%,rgba(238,241,237,0.9)_38%,rgba(238,241,237,0.2)_76%)]" />
        <nav className="relative z-10 mx-auto flex max-w-7xl flex-col items-stretch gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-8">
          <a href={import.meta.env.BASE_URL} className="flex min-w-0 items-center gap-3" aria-label="MarkNote home">
            <img src={`${import.meta.env.BASE_URL}marknote.svg`} alt="" className="h-9 w-9" />
            <span className="truncate text-lg font-semibold tracking-[0px] text-ink">MarkNote</span>
          </a>
          <div className="hidden items-center gap-7 text-sm font-medium text-stone-600 md:flex">
            <a className="transition hover:text-ink" href="#features">
              {t('landing.navFeatures')}
            </a>
            <a className="transition hover:text-ink" href="#sync">
              {t('landing.navSync')}
            </a>
            <a className="transition hover:text-ink" href="#platforms">
              {t('landing.navPlatforms')}
            </a>
            <a className="transition hover:text-ink" href="#privacy">
              {t('landing.navPrivacy')}
            </a>
          </div>
          <div className="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            <LanguageSwitch compact shortLabels />
            <a
              href={actionsHref}
              className="inline-flex h-10 min-w-0 items-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold text-ink shadow-subtle transition hover:border-stone-400 hover:bg-stone-50 sm:px-3"
            >
              <Download size={16} className="shrink-0" />
              <span className="hidden sm:inline">{t('landing.builds')}</span>
            </a>
          </div>
        </nav>

        <div className="relative z-10 mx-auto box-border flex w-full max-w-7xl min-w-0 flex-col justify-center px-5 pb-16 pt-8 md:min-h-[calc(92dvh-73px)] md:px-8 md:pb-20 md:pt-8">
          <div className="mb-5 flex w-full max-w-full items-start gap-2 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium leading-5 text-stone-600 sm:inline-flex sm:w-fit sm:items-center">
            <Sparkles size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 break-words">{t('landing.badge')}</span>
          </div>
          <h1 className="max-w-[11ch] text-5xl font-semibold leading-[0.98] tracking-[0px] text-ink md:text-7xl">
            MarkNote
          </h1>
          <p className="mt-6 max-w-full break-words text-lg leading-8 text-stone-700 md:max-w-[58ch]">
            {t('landing.heroCopy')}
          </p>
          <div className="mt-8 flex w-full max-w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a
              href={appHref}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-white transition hover:bg-graphite sm:w-auto"
            >
              {t('app.open')}
              <ArrowRight size={17} />
            </a>
            <a
              href={repoHref}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-5 text-sm font-semibold text-ink transition hover:border-stone-400 hover:bg-stone-50 sm:w-auto"
            >
              {t('app.viewSource')}
            </a>
          </div>
          <div className="mt-8 grid w-full max-w-full grid-cols-1 gap-2 text-sm text-stone-600 sm:max-w-2xl sm:grid-cols-3">
            {heroStatKeys.map(([valueKey, labelKey]) => (
              <div key={valueKey} className="rounded-md border border-stone-300 bg-white/85 px-3 py-2">
                <span className="block text-sm font-semibold text-ink">{t(valueKey)}</span>
                <span className="mt-1 block text-xs leading-5 text-stone-600">{t(labelKey)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid w-full max-w-full grid-cols-1 gap-2 text-sm text-stone-600 sm:max-w-2xl sm:grid-cols-3">
            {workflowKeys.map((key, index) => (
              <div key={key} className="rounded-md border border-stone-300 bg-white/80 px-3 py-2">
                <span className="mb-2 block text-xs font-semibold text-moss">0{index + 1}</span>
                {t(key)}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl bg-[#f9faf8] px-5 py-16 md:px-8 md:py-20">
        <div className="grid gap-8 md:grid-cols-[0.78fr_1.22fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0px] text-moss">{t('landing.featuresEyebrow')}</p>
            <h2 className="mt-3 max-w-[14ch] text-4xl font-semibold leading-tight tracking-[0px] text-ink md:text-5xl">
              {t('landing.featuresTitle')}
            </h2>
            <p className="mt-5 max-w-[58ch] text-base leading-7 text-stone-600">
              {t('landing.featuresCopy')}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featureKeys.map((feature) => (
              <article key={feature.titleKey} className="rounded-md border border-stone-300 bg-white p-5 shadow-subtle">
                <feature.icon className="mb-5 text-moss" size={22} />
                <h3 className="text-lg font-semibold leading-6 text-ink">{t(feature.titleKey)}</h3>
                <p className="mt-3 text-sm leading-6 text-stone-600">{t(feature.descriptionKey)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="sync" className="border-y border-stone-300 bg-[#f1f4ee]">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.95fr_1.05fr] md:px-8 md:py-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0px] text-moss">{t('landing.syncEyebrow')}</p>
            <h2 className="mt-3 max-w-[13ch] text-4xl font-semibold leading-tight tracking-[0px] text-ink md:text-5xl">
              {t('landing.syncTitle')}
            </h2>
            <p className="mt-5 max-w-[62ch] text-base leading-7 text-stone-700">
              {t('landing.syncCopy')}
            </p>
          </div>
          <div className="grid content-center gap-3">
            {syncProofKeys.map((item) => (
              <div key={item.titleKey} className="grid grid-cols-[44px_minmax(0,1fr)] gap-4 rounded-md border border-stone-300 bg-white p-4 shadow-subtle">
                <div className="grid h-11 w-11 place-items-center rounded-md bg-linen text-moss">
                  <item.icon size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink">{t(item.titleKey)}</h3>
                  <p className="mt-1 text-sm leading-6 text-stone-600">{t(item.descriptionKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="platforms" className="border-b border-stone-300 bg-[#253039] text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[1fr_1fr] md:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0px] text-[#9bb889]">{t('landing.platformsEyebrow')}</p>
            <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-[0px] text-white md:text-5xl">
              {t('landing.platformsTitle')}
            </h2>
            <p className="mt-5 max-w-[62ch] text-base leading-7 text-stone-200">
              {t('landing.platformsCopy')}
            </p>
          </div>
          <div className="grid content-center gap-3">
            {[
              ['macOS Intel', t('landing.macIntelDetail')],
              ['macOS Apple Silicon', t('landing.macArmDetail')],
              ['Windows x64', t('landing.winDetail')],
            ].map(([title, detail]) => (
              <div key={title} className="flex items-start gap-4 rounded-md border border-white/10 bg-white/10 p-4 shadow-subtle">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white text-moss">
                  <MonitorDown size={19} />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-stone-200">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.9fr_1.1fr] md:px-8 md:py-20">
        <div className="rounded-md border border-stone-300 bg-ink p-6 text-white shadow-subtle">
          <Lock size={24} />
          <h2 className="mt-8 text-3xl font-semibold leading-tight tracking-[0px]">{t('landing.privacyTitle')}</h2>
          <p className="mt-4 text-base leading-7 text-stone-200">
            {t('landing.privacyCopy')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {privacyKeys.map((key) => (
            <div key={key} className="flex items-start gap-3 rounded-md border border-stone-300 bg-white p-4">
              <Check className="mt-0.5 shrink-0 text-moss" size={18} />
              <span className="text-sm font-medium leading-6 text-stone-700">{t(key)}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-stone-300 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-stone-600 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}marknote.svg`} alt="" className="h-8 w-8" />
            <span>MarkNote</span>
          </div>
          <div className="flex flex-wrap gap-5">
            <a className="transition hover:text-ink" href={appHref}>
              {t('landing.footerWebApp')}
            </a>
            <a className="transition hover:text-ink" href={actionsHref}>
              {t('landing.footerArtifacts')}
            </a>
            <a className="transition hover:text-ink" href={repoHref}>
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ProductPreview({ hero = false }: { hero?: boolean }) {
  const { t } = useI18n();

  return (
    <div
      className={
        hero
          ? 'pointer-events-none absolute -right-36 top-24 hidden w-[820px] rotate-[-1deg] lg:block xl:right-4 xl:w-[900px]'
          : 'relative min-h-[460px] overflow-x-auto pb-4'
      }
    >
      <div className="absolute inset-0 translate-x-8 translate-y-8 rounded-md border border-stone-300 bg-clay/10" />
      <div
        className={`relative min-w-[640px] overflow-hidden rounded-md border border-stone-300 bg-white shadow-[0_24px_80px_rgba(36,34,31,0.18)] ${
          hero ? 'min-w-0' : ''
        }`}
      >
        <div className="flex h-10 items-center justify-between border-b border-stone-200 bg-[#f7f3ec] px-4">
          <div className="flex gap-2">
            <span className="h-3 w-3 rounded-full bg-[#d96b5d]" />
            <span className="h-3 w-3 rounded-full bg-[#dfb85f]" />
            <span className="h-3 w-3 rounded-full bg-[#6aa76f]" />
          </div>
          <span className="text-xs font-medium text-stone-500">{t('landing.previewWorkspace')}</span>
        </div>
        <div className="grid min-h-[452px] grid-cols-[130px_168px_minmax(300px,1fr)] bg-paper sm:grid-cols-[156px_198px_minmax(350px,1fr)] lg:grid-cols-[170px_220px_1fr]">
          <aside className="grid border-r border-stone-200 bg-linen p-4">
            <div>
              <div className="mb-5 flex items-center gap-2">
                <img src={`${import.meta.env.BASE_URL}marknote.svg`} alt="" className="h-8 w-8" />
                <div className="min-w-0 font-semibold text-ink">MarkNote</div>
              </div>
              <PreviewSearch />
              <PreviewNav icon={<Laptop size={15} />} label={t('landing.previewAllNotes')} active />
              <PreviewNav icon={<FolderOpen size={15} />} label={t('landing.previewLibrary')} />
              <PreviewNav icon={<Braces size={15} />} label={t('tag.codeSnippets')} />
              <PreviewNav icon={<Tags size={15} />} label={t('landing.previewProjects')} />
            </div>
            <div className="self-end rounded-md border border-stone-300 bg-white p-3 text-xs text-stone-600">
              <div className="mb-2 flex items-center gap-2 font-semibold text-moss">
                <Cloud size={14} />
                {t('landing.previewSyncStatus')}
              </div>
              <p className="leading-5">{t('landing.previewSyncDetail')}</p>
            </div>
          </aside>
          <section className="border-r border-stone-200 bg-white p-3">
            <PreviewNote title={t('landing.previewLaunchTitle')} tag={t('landing.previewWork')} active />
            <PreviewNote title={t('landing.previewCodeTitle')} tag={t('tag.codeSnippets')} />
            <PreviewNote title={t('landing.previewReadingTitle')} tag={t('landing.previewPersonal')} />
            <div className="mt-4 rounded-md border border-stone-200 bg-[#fbfaf7] p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
                <History size={14} />
                {t('landing.previewHistory')}
              </div>
              <div className="space-y-2 text-xs text-stone-500">
                <div className="h-2 rounded-full bg-stone-200" />
                <div className="h-2 w-4/5 rounded-full bg-stone-200" />
                <div>{t('landing.previewHistoryDetail')}</div>
              </div>
            </div>
          </section>
          <article className="bg-[#fbfaf7] p-5 sm:p-7">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="rounded-md bg-moss px-2 py-1 text-xs font-semibold text-white">{t('landing.previewWork')}</span>
              <span className="text-xs text-stone-500">{t('landing.previewSaved')}</span>
            </div>
            <h3 className="text-3xl font-semibold tracking-[0px] text-ink">{t('landing.previewLaunchTitle')}</h3>
            <p className="mt-4 max-w-[54ch] text-sm leading-6 text-stone-600">
              {t('landing.previewCopy')}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_0.8fr]">
              <div className="rounded-md border border-stone-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                  <ListChecks size={16} />
                  {t('landing.previewChecklistTitle')}
                </div>
                <PreviewChecklistItem label={t('landing.previewChecklistOrganize')} />
                <PreviewChecklistItem label={t('landing.previewChecklistSync')} />
                <PreviewChecklistItem label={t('landing.previewChecklistBuild')} />
              </div>
              <div className="rounded-md border border-stone-200 bg-white p-4">
                <div className="mb-3 h-20 rounded-md bg-[linear-gradient(135deg,#4f6f52,#b45f45)]" />
                <div className="space-y-2">
                  <div className="h-2.5 w-full rounded-full bg-stone-200" />
                  <div className="h-2.5 w-4/5 rounded-full bg-stone-200" />
                  <div className="h-2.5 w-2/3 rounded-full bg-stone-200" />
                </div>
              </div>
            </div>
            <pre className="mt-4 overflow-hidden rounded-md bg-[#1f2329] p-4 text-xs leading-6 text-stone-100">
              <code>{`npm run check:google-oauth\nnpm run check:supabase-sync:oauth\nnpm run dist:mac:arm64`}</code>
            </pre>
          </article>
        </div>
      </div>
    </div>
  );
}

function PreviewSearch() {
  const { t } = useI18n();

  return (
    <div className="mb-4 flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-xs text-stone-400">
      <Search size={14} />
      {t('landing.previewSearch')}
    </div>
  );
}

function PreviewNav({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <div className={`mb-2 flex h-9 items-center gap-2 rounded-md px-3 text-sm ${active ? 'bg-white shadow-subtle' : 'text-stone-600'}`}>
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

function PreviewNote({ title, tag, active = false }: { title: string; tag: string; active?: boolean }) {
  const { t } = useI18n();

  return (
    <div className={`mb-3 rounded-md border p-3 ${active ? 'border-moss bg-linen' : 'border-stone-200 bg-white'}`}>
      <div className="text-sm font-semibold text-ink">{title}</div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-stone-500">
        <span className="min-w-0 truncate">{tag}</span>
        <span className="shrink-0">{t('landing.previewAgo')}</span>
      </div>
    </div>
  );
}

function PreviewChecklistItem({ label }: { label: string }) {
  return (
    <div className="mt-2 flex items-start gap-2 text-xs leading-5 text-stone-600">
      <Check size={14} className="mt-0.5 shrink-0 text-moss" />
      <span>{label}</span>
    </div>
  );
}
