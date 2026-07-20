import type { ReactNode } from 'react';
import {
  ArrowRight,
  Braces,
  Check,
  Cloud,
  CloudCog,
  Download,
  FileDown,
  FolderOpen,
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
  type LucideIcon,
} from 'lucide-react';
import { LanguageSwitch } from './components/LanguageSwitch';
import { useI18n } from './i18n';

const appHref = `${import.meta.env.BASE_URL}?app=1`;
const repoHref = 'https://github.com/xujiehui/MarkNote';
const releaseHref = `${repoHref}/releases/latest`;

const featureKeys = [
  { icon: Search, titleKey: 'landing.featureSearchTitle', descriptionKey: 'landing.featureSearchDesc' },
  { icon: Image, titleKey: 'landing.featureEditorTitle', descriptionKey: 'landing.featureEditorDesc' },
  { icon: History, titleKey: 'landing.featureHistoryTitle', descriptionKey: 'landing.featureHistoryDesc' },
  { icon: FileDown, titleKey: 'landing.featureExportTitle', descriptionKey: 'landing.featureExportDesc' },
];

const syncProofKeys = [
  { icon: Lock, titleKey: 'landing.syncLocalTitle', descriptionKey: 'landing.syncLocalDesc' },
  { icon: CloudCog, titleKey: 'landing.syncRuntimeTitle', descriptionKey: 'landing.syncRuntimeDesc' },
  { icon: SearchCheck, titleKey: 'landing.syncDiagnoseTitle', descriptionKey: 'landing.syncDiagnoseDesc' },
];

const platformKeys = [
  { icon: MonitorDown, label: 'macOS Intel', detailKey: 'landing.macIntelDetail', href: releaseHref, actionKey: 'landing.platformDownload' },
  { icon: MonitorDown, label: 'macOS Apple Silicon', detailKey: 'landing.macArmDetail', href: releaseHref, actionKey: 'landing.platformDownload' },
  { icon: MonitorDown, label: 'Windows x64', detailKey: 'landing.winDetail', href: releaseHref, actionKey: 'landing.platformDownload' },
  { icon: Laptop, label: 'Web + PWA', detailKey: 'landing.webDetail', href: appHref, actionKey: 'landing.platformOpen' },
];

const privacyKeys = ['landing.privacyLocal', 'landing.privacySync', 'landing.privacyPortable'];

export function LandingPage() {
  const { t } = useI18n();

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[#f5f6f8] text-[#151a23]">
      <SiteHeader />

      <section className="border-b border-[#e5e7eb] bg-[#f5f6f8]">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-12 md:grid-cols-[0.82fr_1.18fr] md:px-8 md:pb-16 md:pt-16">
          <div className="min-w-0">
            <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[#bfdbfe] bg-[#eaf2ff] px-3 py-1.5 text-sm font-semibold leading-5 text-[#2563eb]">
              <Sparkles size={15} className="shrink-0" />
              <span className="min-w-0 break-words">{t('landing.heroEyebrow')}</span>
            </div>
            <h1 className="mt-6 max-w-[12ch] text-5xl font-semibold leading-[1.04] tracking-[0px] text-[#151a23] md:max-w-[15ch] md:text-6xl">
              {t('landing.heroTitle')}
            </h1>
            <p className="mt-6 max-w-[50ch] text-lg leading-8 text-[#4b5563]">{t('landing.heroCopy')}</p>
            <div className="md:hidden">
              <MobileWorkspacePreview />
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={appHref}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#2f7df6] px-5 text-sm font-semibold text-white transition hover:bg-[#256ce0] active:scale-[0.98]"
              >
                {t('app.open')}
                <ArrowRight size={17} />
              </a>
              <a
                href="#features"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[#d1d5db] bg-white px-5 text-sm font-semibold text-[#151a23] transition hover:border-[#9ca3af] hover:bg-[#f9fafb] active:scale-[0.98]"
              >
                {t('landing.heroSecondaryCta')}
                <ArrowRight size={17} />
              </a>
            </div>
            <div className="mt-10 flex max-w-2xl items-center gap-2 border-t border-[#dfe3e8] pt-5 text-sm leading-6 text-[#4b5563]">
              <Check size={17} className="shrink-0 text-[#16a34a]" />
              <span>{t('landing.heroProof')}</span>
            </div>
          </div>

          <div className="min-w-0">
            <WorkspacePreview />
          </div>
        </div>
      </section>

      <section id="features" className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0px] text-[#2563eb]">{t('landing.featuresEyebrow')}</p>
            <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-[0px] text-[#151a23] md:text-5xl">
              {t('landing.featuresTitle')}
            </h2>
            <p className="mt-5 text-base leading-7 text-[#6b7280]">{t('landing.featuresCopy')}</p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
            <article className="min-h-[430px] overflow-hidden rounded-xl border border-[#1f2937] bg-[#111827] p-6 text-white shadow-[0_18px_40px_rgba(15,23,42,0.14)] md:p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0px] text-[#93c5fd]">{t('landing.editorEyebrow')}</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">{t('landing.editorTitle')}</h3>
                </div>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#2563eb] text-white">
                  <ListChecks size={19} />
                </div>
              </div>
              <p className="mt-5 max-w-[52ch] text-sm leading-6 text-[#cbd5e1]">{t('landing.editorCopy')}</p>
              <div className="mt-8 rounded-lg border border-white/10 bg-[#1f2937] p-4">
                <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-3 text-xs text-[#9ca3af]">
                  <span className="rounded-md bg-[#2563eb] px-2 py-1 font-semibold text-white">{t('landing.previewWork')}</span>
                  <span>{t('landing.previewSaved')}</span>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="h-3 w-4/5 rounded bg-[#e5e7eb]" />
                  <div className="h-3 w-full rounded bg-[#4b5563]" />
                  <div className="h-3 w-3/5 rounded bg-[#4b5563]" />
                  <div className="mt-5 grid grid-cols-[16px_1fr] gap-2 text-[#cbd5e1]">
                    <Check size={15} className="mt-0.5 text-[#60a5fa]" />
                    <span>{t('landing.editorChecklist')}</span>
                  </div>
                </div>
              </div>
              <pre className="mt-4 overflow-hidden rounded-lg bg-[#0f172a] p-4 text-xs leading-6 text-[#bfdbfe]"><code>note.save() / note.sync()</code></pre>
            </article>

            <div className="divide-y divide-[#e5e7eb] overflow-hidden rounded-xl border border-[#e5e7eb] bg-[#f9fafb]">
              {featureKeys.map((feature) => (
                <FeatureRow key={feature.titleKey} icon={feature.icon} title={t(feature.titleKey)} description={t(feature.descriptionKey)} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="sync" className="border-b border-[#bfdbfe] bg-[#eef5ff]">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:grid-cols-[0.88fr_1.12fr] md:px-8 md:py-24">
          <div className="self-center">
            <div className="inline-flex items-center gap-2 rounded-lg border border-[#bfdbfe] bg-white px-3 py-1.5 text-sm font-semibold text-[#2563eb]">
              <Cloud size={15} />
              {t('landing.syncEyebrow')}
            </div>
            <h2 className="mt-5 max-w-[14ch] text-4xl font-semibold leading-tight tracking-[0px] text-[#151a23] md:text-5xl">
              {t('landing.syncTitle')}
            </h2>
            <p className="mt-5 max-w-[58ch] text-base leading-7 text-[#4b5563]">{t('landing.syncCopy')}</p>
            <a href={appHref} className="mt-8 inline-flex h-11 items-center gap-2 rounded-lg bg-[#2f7df6] px-4 text-sm font-semibold text-white transition hover:bg-[#256ce0] active:scale-[0.98]">
              {t('landing.syncCta')}
              <ArrowRight size={16} />
            </a>
          </div>

          <SyncPanelPreview />
        </div>
      </section>

      <section id="platforms" className="border-b border-[#1f2937] bg-[#111827] text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:grid-cols-[0.8fr_1.2fr] md:px-8 md:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0px] text-[#93c5fd]">{t('landing.platformsEyebrow')}</p>
            <h2 className="mt-3 max-w-[12ch] text-4xl font-semibold leading-tight tracking-[0px] md:text-5xl">{t('landing.platformsTitle')}</h2>
            <p className="mt-5 max-w-[54ch] text-base leading-7 text-[#cbd5e1]">{t('landing.platformsCopy')}</p>
            <a href={releaseHref} className="mt-8 inline-flex h-11 items-center gap-2 rounded-lg border border-white/20 px-4 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10">
              {t('landing.platformsCta')}
              <ArrowRight size={16} />
            </a>
          </div>
          <div className="divide-y divide-white/10 border-y border-white/10">
            {platformKeys.map((item) => (
              <a key={item.label} href={item.href} className="group grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-4 py-4 transition hover:bg-white/5">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-white text-[#2563eb]"><item.icon size={18} /></div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-white">{item.label}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#94a3b8]">{t(item.detailKey)}</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[#93c5fd] transition group-hover:text-white">
                  {t(item.actionKey)}
                  <Download size={15} />
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:grid-cols-[0.8fr_1.2fr] md:px-8 md:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0px] text-[#2563eb]">{t('landing.privacyEyebrow')}</p>
            <h2 className="mt-3 max-w-[12ch] text-4xl font-semibold leading-tight tracking-[0px] text-[#151a23] md:text-5xl">{t('landing.privacyTitle')}</h2>
            <p className="mt-5 max-w-[54ch] text-base leading-7 text-[#6b7280]">{t('landing.privacyCopy')}</p>
          </div>
          <div className="divide-y divide-[#e5e7eb] border-y border-[#e5e7eb]">
            {privacyKeys.map((key) => (
              <div key={key} className="flex items-start gap-3 py-5 text-base leading-7 text-[#374151]">
                <Check size={18} className="mt-1 shrink-0 text-[#2f7df6]" />
                <span>{t(key)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-[#f5f6f8]">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-sm text-[#6b7280] md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}marknote.svg`} alt="" className="h-8 w-8" />
            <div>
              <div className="font-semibold text-[#151a23]">MarkNote</div>
              <div className="mt-0.5 text-xs">{t('landing.footerTagline')}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a className="hover:text-[#151a23]" href={appHref}>{t('landing.footerWebApp')}</a>
            <a className="hover:text-[#151a23]" href={releaseHref}>{t('landing.footerArtifacts')}</a>
            <a className="hover:text-[#151a23]" href={repoHref}>{t('landing.footerSource')}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function SiteHeader() {
  const { t } = useI18n();

  return (
    <header className="border-b border-[#e5e7eb] bg-[#f5f6f8]">
      <nav className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-3 md:px-8">
        <a href={import.meta.env.BASE_URL} className="flex min-w-0 items-center gap-3" aria-label="MarkNote home">
          <img src={`${import.meta.env.BASE_URL}marknote.svg`} alt="" className="h-9 w-9" />
          <span className="truncate text-lg font-semibold text-[#151a23]">MarkNote</span>
        </a>
        <div className="hidden items-center gap-6 text-sm font-medium text-[#6b7280] lg:flex">
          <a className="hover:text-[#151a23]" href="#features">{t('landing.navFeatures')}</a>
          <a className="hover:text-[#151a23]" href="#sync">{t('landing.navSync')}</a>
          <a className="hover:text-[#151a23]" href="#platforms">{t('landing.navPlatforms')}</a>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitch compact shortLabels />
          <a href={appHref} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2f7df6] px-3 text-sm font-semibold text-white transition hover:bg-[#256ce0] active:scale-[0.98]">
            {t('landing.headerCta')}
            <ArrowRight size={15} />
          </a>
        </div>
      </nav>
    </header>
  );
}

function WorkspacePreview() {
  const { t } = useI18n();

  return (
    <div className="relative hidden md:block">
      <div className="absolute -inset-3 rounded-2xl border border-[#bfdbfe] bg-[#eef5ff]" />
      <div className="relative overflow-hidden rounded-xl border border-[#d1d5db] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.14)]">
        <div className="flex h-11 items-center justify-between border-b border-[#e5e7eb] bg-white px-4 text-xs text-[#6b7280]">
          <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /></div>
          <span className="font-medium">{t('landing.previewWorkspace')}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#22c55e]" />{t('landing.previewSaved')}</span>
        </div>
        <div className="grid min-h-[420px] grid-cols-[154px_188px_minmax(0,1fr)] bg-[#f5f6f8]">
          <PreviewSidebar />
          <PreviewNoteList />
          <PreviewEditor />
        </div>
      </div>
    </div>
  );
}

function PreviewSidebar() {
  const { t } = useI18n();

  return (
    <aside className="grid border-r border-[#e5e7eb] bg-[#f5f6f8] p-4">
      <div>
        <div className="mb-5 flex items-center gap-2"><img src={`${import.meta.env.BASE_URL}marknote.svg`} alt="" className="h-8 w-8" /><span className="font-semibold text-[#151a23]">MarkNote</span></div>
        <div className="mb-4 flex h-8 items-center gap-2 rounded-lg bg-[#eaedf2] px-2.5 text-[11px] text-[#6b7280]"><Search size={13} /><span className="truncate">{t('landing.previewSearch')}</span></div>
        <PreviewNav icon={<Laptop size={14} />} label={t('landing.previewAllNotes')} active />
        <PreviewNav icon={<FolderOpen size={14} />} label={t('landing.previewLibrary')} />
        <PreviewNav icon={<Braces size={14} />} label={t('landing.previewCode')} />
        <PreviewNav icon={<Tags size={14} />} label={t('landing.previewProjects')} />
      </div>
      <div className="self-end rounded-lg border border-[#e5e7eb] bg-white p-3 text-[11px] leading-5 text-[#6b7280]">
        <div className="mb-1 flex items-center gap-2 font-semibold text-[#2563eb]"><Cloud size={13} />{t('landing.previewSync')}</div>
        <div>{t('landing.previewSyncDetail')}</div>
      </div>
    </aside>
  );
}

function PreviewNoteList() {
  const { t } = useI18n();

  return (
    <section className="border-r border-[#e5e7eb] bg-white p-3">
      <PreviewNote title={t('landing.previewNoteTitle')} tag={t('landing.previewWork')} active />
      <PreviewNote title={t('landing.previewCodeTitle')} tag={t('landing.previewCode')} />
      <PreviewNote title={t('landing.previewReadingTitle')} tag={t('landing.previewPersonal')} />
      <div className="mt-4 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[#374151]"><History size={13} />{t('landing.previewHistory')}</div>
        <div className="space-y-2"><div className="h-2 rounded bg-[#e5e7eb]" /><div className="h-2 w-4/5 rounded bg-[#e5e7eb]" /><div className="text-[10px] text-[#9ca3af]">{t('landing.previewHistoryDetail')}</div></div>
      </div>
    </section>
  );
}

function PreviewEditor() {
  const { t } = useI18n();

  return (
    <article className="min-w-0 bg-white p-6">
      <div className="flex items-center justify-between gap-3"><span className="rounded-lg bg-[#eaf2ff] px-2.5 py-1 text-[11px] font-semibold text-[#2563eb]">{t('landing.previewWork')}</span><span className="text-[11px] text-[#6b7280]">{t('landing.previewSaved')}</span></div>
      <h3 className="mt-5 text-2xl font-semibold text-[#151a23]">{t('landing.previewNoteTitle')}</h3>
      <p className="mt-3 text-xs leading-5 text-[#6b7280]">{t('landing.previewEditorCopy')}</p>
      <div className="mt-4 flex items-center gap-1 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-1 text-[#6b7280]"><PreviewTool icon={<Braces size={13} />} /><PreviewTool icon={<Image size={13} />} /><PreviewTool icon={<ListChecks size={13} />} /><span className="ml-auto px-2 text-[10px] text-[#9ca3af]">{t('landing.previewToolbar')}</span></div>
      <div className="mt-4 rounded-lg border border-[#e5e7eb] bg-white p-4"><div className="flex items-start gap-2 text-xs leading-5 text-[#4b5563]"><Check size={14} className="mt-0.5 shrink-0 text-[#2f7df6]" />{t('landing.previewChecklist')}</div><div className="mt-3 h-2 rounded bg-[#f3f4f6]" /><div className="mt-2 h-2 w-4/5 rounded bg-[#f3f4f6]" /></div>
      <pre className="mt-4 overflow-hidden rounded-lg bg-[#111827] p-4 text-[10px] leading-5 text-[#bfdbfe]"><code>note.save() / note.sync()</code></pre>
    </article>
  );
}

function MobileWorkspacePreview() {
  const { t } = useI18n();

  return (
    <div className="mt-10 overflow-hidden rounded-xl border border-[#d1d5db] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.1)] md:hidden">
      <div className="flex h-10 items-center justify-between border-b border-[#e5e7eb] px-4 text-[11px] text-[#6b7280]"><span className="font-semibold text-[#151a23]">MarkNote</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#22c55e]" />{t('landing.previewSaved')}</span></div>
      <div className="p-4"><div className="flex h-9 items-center gap-2 rounded-lg bg-[#eaedf2] px-3 text-xs text-[#6b7280]"><Search size={14} />{t('landing.previewSearch')}</div><div className="mt-4 rounded-lg border-l-2 border-[#2f7df6] bg-[#eaf2ff] p-3"><div className="text-sm font-semibold text-[#151a23]">{t('landing.previewNoteTitle')}</div><div className="mt-1 text-xs text-[#6b7280]">{t('landing.previewWork')} · {t('landing.previewSaved')}</div></div><div className="mt-4 rounded-lg border border-[#e5e7eb] p-4"><div className="text-lg font-semibold text-[#151a23]">{t('landing.previewNoteTitle')}</div><p className="mt-2 text-sm leading-6 text-[#6b7280]">{t('landing.previewEditorCopy')}</p></div></div>
    </div>
  );
}

function SyncPanelPreview() {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-xl border border-[#bfdbfe] bg-white shadow-[0_18px_40px_rgba(37,99,235,0.1)]">
      <div className="flex items-center justify-between gap-4 border-b border-[#e5e7eb] px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#eaf2ff] text-[#2563eb]"><Cloud size={18} /></div><div><div className="text-sm font-semibold text-[#151a23]">{t('landing.syncPanelTitle')}</div><div className="mt-1 text-xs text-[#6b7280]">{t('landing.syncPanelSubtitle')}</div></div></div><span className="flex items-center gap-1.5 text-xs font-semibold text-[#16a34a]"><span className="h-2 w-2 rounded-full bg-[#22c55e]" />{t('landing.syncPanelStatus')}</span></div>
      <div className="divide-y divide-[#e5e7eb]">{syncProofKeys.map((item) => <div key={item.titleKey} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 px-5 py-4"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#f5f6f8] text-[#2563eb]"><item.icon size={17} /></div><div className="min-w-0"><h3 className="text-sm font-semibold text-[#151a23]">{t(item.titleKey)}</h3><p className="mt-1 text-xs leading-5 text-[#6b7280]">{t(item.descriptionKey)}</p></div></div>)}</div>
      <div className="flex items-center justify-between border-t border-[#e5e7eb] bg-[#f9fafb] px-5 py-3 text-xs text-[#6b7280]"><span>{t('landing.syncPanelQueue')}</span><span className="font-semibold text-[#16a34a]">{t('landing.syncPanelReady')}</span></div>
    </div>
  );
}

function FeatureRow({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <article className="flex items-start gap-4 bg-[#f9fafb] px-5 py-5 md:px-6"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-[#2563eb] shadow-[0_1px_2px_rgba(15,23,42,0.06)]"><Icon size={18} /></div><div className="min-w-0"><h3 className="text-base font-semibold text-[#151a23]">{title}</h3><p className="mt-1 text-sm leading-6 text-[#6b7280]">{description}</p></div></article>;
}

function PreviewNav({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
  return <div className={`mb-1 flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs ${active ? 'bg-white font-semibold text-[#2563eb] shadow-[0_1px_2px_rgba(15,23,42,0.06)]' : 'text-[#6b7280]'}`}>{icon}<span className="min-w-0 truncate">{label}</span></div>;
}

function PreviewNote({ title, tag, active = false }: { title: string; tag: string; active?: boolean }) {
  const { t } = useI18n();

  return <div className={`mb-2 rounded-lg border p-3 ${active ? 'border-[#93c5fd] bg-[#eaf2ff]' : 'border-[#e5e7eb] bg-white'}`}><div className="truncate text-xs font-semibold text-[#151a23]">{title}</div><div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[#6b7280]"><span className="truncate">{tag}</span><span className="shrink-0">{t('landing.previewAgo')}</span></div></div>;
}

function PreviewTool({ icon }: { icon: ReactNode }) {
  return <span className="grid h-6 w-6 place-items-center rounded-md bg-white text-[#6b7280]">{icon}</span>;
}
