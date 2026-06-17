import {
  ArrowRight,
  Braces,
  Check,
  Download,
  FileDown,
  HardDrive,
  Image,
  Laptop,
  Lock,
  MonitorDown,
  Search,
  Sparkles,
  Tags,
} from 'lucide-react';

const appHref = `${import.meta.env.BASE_URL}?app=1`;
const repoHref = 'https://github.com/xujiehui/MarkNote';
const actionsHref = 'https://github.com/xujiehui/MarkNote/actions/workflows/desktop-build.yml';

const features = [
  {
    icon: HardDrive,
    title: 'Local-first storage',
    description: 'Notes stay in your browser or desktop app storage by default, with no account gate in the writing flow.',
  },
  {
    icon: Image,
    title: 'Images that belong to the note',
    description: 'Paste, upload, align, resize, and export Base64 images without leaving the editor.',
  },
  {
    icon: Braces,
    title: 'Code blocks for real work',
    description: 'Syntax highlighting, language selection, line numbers, and one-click copy keep snippets usable.',
  },
  {
    icon: FileDown,
    title: 'Portable import and export',
    description: 'Move notes as Markdown, HTML, PDF, or JSON backups when your workflow changes.',
  },
];

const workflow = ['Capture fragments', 'Shape them into notes', 'Export when they need to travel'];

export function LandingPage() {
  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#f9faf8] text-ink">
      <section className="relative min-h-[92dvh] border-b border-stone-300/70 bg-[#eef1ed]">
        <div className="absolute inset-x-0 top-0 h-px bg-white/80" />
        <ProductPreview hero />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(238,241,237,0.98)_0%,rgba(238,241,237,0.88)_36%,rgba(238,241,237,0.18)_72%)]" />
        <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <a href={import.meta.env.BASE_URL} className="flex items-center gap-3" aria-label="MarkNote home">
            <img src={`${import.meta.env.BASE_URL}marknote.svg`} alt="" className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-[0px] text-ink">MarkNote</span>
          </a>
          <div className="hidden items-center gap-7 text-sm font-medium text-stone-600 md:flex">
            <a className="transition hover:text-ink" href="#features">
              Features
            </a>
            <a className="transition hover:text-ink" href="#platforms">
              Platforms
            </a>
            <a className="transition hover:text-ink" href="#privacy">
              Privacy
            </a>
          </div>
          <a
            href={actionsHref}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink shadow-subtle transition hover:border-stone-400 hover:bg-stone-50"
          >
            <Download size={16} />
            Builds
          </a>
        </nav>

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col justify-center px-5 pb-16 pt-12 md:min-h-[calc(92dvh-73px)] md:px-8 md:pb-20 md:pt-8">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-600">
            <Sparkles size={15} />
            Desktop note workspace for macOS and Windows
          </div>
          <h1 className="max-w-[11ch] text-5xl font-semibold leading-[0.98] tracking-[0px] text-ink md:text-7xl">
            MarkNote
          </h1>
          <p className="mt-6 max-w-[58ch] text-lg leading-8 text-stone-700">
            A calm, local-first writing desk for notes that mix prose, images, code snippets, and portable exports.
            It opens quickly, stays out of your way, and keeps your work easy to move.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href={appHref}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-white transition hover:bg-graphite"
            >
              Open web app
              <ArrowRight size={17} />
            </a>
            <a
              href={repoHref}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-5 text-sm font-semibold text-ink transition hover:border-stone-400 hover:bg-stone-50"
            >
              View source
            </a>
          </div>
          <div className="mt-8 grid max-w-xl grid-cols-3 gap-2 text-sm text-stone-600">
            {workflow.map((item, index) => (
              <div key={item} className="rounded-md border border-stone-300 bg-white/80 px-3 py-2">
                <span className="mb-2 block text-xs font-semibold text-moss">0{index + 1}</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl bg-[#f9faf8] px-5 py-16 md:px-8 md:py-20">
        <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0px] text-moss">For mixed-format thinking</p>
            <h2 className="mt-3 max-w-[12ch] text-4xl font-semibold leading-tight tracking-[0px] text-ink md:text-5xl">
              Everything in one note.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {features.map((feature) => (
              <article key={feature.title} className="rounded-md border border-stone-300 bg-white p-5 shadow-subtle">
                <feature.icon className="mb-5 text-moss" size={22} />
                <h3 className="text-lg font-semibold text-ink">{feature.title}</h3>
                <p className="mt-3 text-sm leading-6 text-stone-600">{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="platforms" className="border-y border-stone-300 bg-[#253039] text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[1fr_1fr] md:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0px] text-[#9bb889]">GitHub Actions builds</p>
            <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-[0px] text-white md:text-5xl">
              Packaged for the machines you use.
            </h2>
            <p className="mt-5 max-w-[62ch] text-base leading-7 text-stone-200">
              Every push can produce downloadable artifacts for macOS Intel, macOS Apple Silicon, and Windows x64.
              The same React workspace powers the web app and the desktop shells.
            </p>
          </div>
          <div className="grid content-center gap-3">
            {[
              ['macOS Intel', 'DMG and ZIP artifacts from macos-15-intel'],
              ['macOS Apple Silicon', 'Native arm64 package from macos-15'],
              ['Windows x64', 'NSIS installer and portable executable'],
            ].map(([title, detail]) => (
              <div key={title} className="flex items-start gap-4 rounded-md border border-white/12 bg-white/8 p-4 shadow-subtle">
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
          <h2 className="mt-8 text-3xl font-semibold leading-tight tracking-[0px]">Private by default, portable by design.</h2>
          <p className="mt-4 text-base leading-7 text-stone-200">
            MarkNote stores notes locally and gives you explicit export routes. It is built for people who want useful
            software without turning every draft into a cloud object first.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {['No login required for the web app', 'IndexedDB local persistence', 'JSON backup export', 'Markdown and HTML import'].map(
            (item) => (
              <div key={item} className="flex items-center gap-3 rounded-md border border-stone-300 bg-white p-4">
                <Check className="text-moss" size={18} />
                <span className="text-sm font-medium text-stone-700">{item}</span>
              </div>
            ),
          )}
        </div>
      </section>

      <footer className="border-t border-stone-300 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-stone-600 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}marknote.svg`} alt="" className="h-8 w-8" />
            <span>MarkNote</span>
          </div>
          <div className="flex gap-5">
            <a className="transition hover:text-ink" href={appHref}>
              Web app
            </a>
            <a className="transition hover:text-ink" href={actionsHref}>
              Desktop artifacts
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
          <span className="text-xs font-medium text-stone-500">MarkNote workspace</span>
        </div>
        <div className="grid min-h-[420px] grid-cols-[120px_150px_minmax(260px,1fr)] bg-paper sm:grid-cols-[150px_190px_minmax(320px,1fr)] lg:grid-cols-[160px_210px_1fr]">
          <aside className="border-r border-stone-200 bg-linen p-4">
            <div className="mb-5 flex items-center gap-2">
              <img src={`${import.meta.env.BASE_URL}marknote.svg`} alt="" className="h-8 w-8" />
              <div className="font-semibold text-ink">MarkNote</div>
            </div>
            <PreviewSearch />
            <PreviewNav icon={<Laptop size={15} />} label="All notes" active />
            <PreviewNav icon={<Tags size={15} />} label="Work" />
            <PreviewNav icon={<Tags size={15} />} label="Personal" />
          </aside>
          <section className="border-r border-stone-200 bg-white p-3">
            <PreviewNote title="Launch checklist" tag="Work" active />
            <PreviewNote title="Code snippet vault" tag="Code" />
            <PreviewNote title="Reading notes" tag="Personal" />
          </section>
          <article className="bg-[#fbfaf7] p-5 sm:p-7">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-md bg-moss px-2 py-1 text-xs font-semibold text-white">Work</span>
              <span className="text-xs text-stone-500">Saved locally</span>
            </div>
            <h3 className="text-3xl font-semibold tracking-[0px] text-ink">Launch checklist</h3>
            <p className="mt-4 max-w-[54ch] text-sm leading-6 text-stone-600">
              Collect product copy, final screenshots, and release artifacts before publishing the public page.
            </p>
            <div className="mt-4 rounded-md border border-stone-200 bg-white p-4">
              <div className="mb-3 h-20 rounded-md bg-[linear-gradient(135deg,#4f6f52,#b45f45)]" />
              <div className="space-y-2">
                <div className="h-2.5 w-full rounded-full bg-stone-200" />
                <div className="h-2.5 w-4/5 rounded-full bg-stone-200" />
                <div className="h-2.5 w-2/3 rounded-full bg-stone-200" />
              </div>
            </div>
            <pre className="mt-4 overflow-hidden rounded-md bg-[#1f2329] p-4 text-xs leading-6 text-stone-100">
              <code>{`npm run build\nnpm run package:mac:arm64\nnpm run package:win:x64`}</code>
            </pre>
          </article>
        </div>
      </div>
    </div>
  );
}

function PreviewSearch() {
  return (
    <div className="mb-4 flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-xs text-stone-400">
      <Search size={14} />
      Search notes
    </div>
  );
}

function PreviewNav({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div className={`mb-2 flex h-9 items-center gap-2 rounded-md px-3 text-sm ${active ? 'bg-white shadow-subtle' : 'text-stone-600'}`}>
      {icon}
      {label}
    </div>
  );
}

function PreviewNote({ title, tag, active = false }: { title: string; tag: string; active?: boolean }) {
  return (
    <div className={`mb-3 rounded-md border p-3 ${active ? 'border-moss bg-linen' : 'border-stone-200 bg-white'}`}>
      <div className="text-sm font-semibold text-ink">{title}</div>
      <div className="mt-2 flex items-center justify-between text-xs text-stone-500">
        <span>{tag}</span>
        <span>2m ago</span>
      </div>
    </div>
  );
}
