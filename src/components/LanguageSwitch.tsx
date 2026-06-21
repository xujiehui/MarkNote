import type { Language } from '../i18n';
import { useI18n } from '../i18n';

interface LanguageSwitchProps {
  compact?: boolean;
  fullWidth?: boolean;
  shortLabels?: boolean;
}

const languages: Array<{ value: Language; labelKey: string }> = [
  { value: 'zh-CN', labelKey: 'language.zh' },
  { value: 'en', labelKey: 'language.en' },
];

export function LanguageSwitch({ compact = false, fullWidth = false, shortLabels = false }: LanguageSwitchProps) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      className={`inline-flex min-w-0 items-center rounded-md border border-stone-300 bg-white p-0.5 text-xs shadow-subtle ${
        fullWidth ? 'w-full' : ''
      } ${
        shortLabels && !fullWidth ? 'w-[76px]' : ''
      } ${
        compact ? '' : 'gap-1'
      }`}
      aria-label={t('language.label')}
    >
      {languages.map((item) => {
        const active = language === item.value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => setLanguage(item.value)}
            className={`h-7 min-w-0 rounded px-2 font-medium transition ${
              fullWidth || shortLabels ? 'flex-1' : ''
            } ${
              active ? 'bg-ink text-white' : 'text-stone-600 hover:bg-stone-100 hover:text-ink'
            }`}
            aria-pressed={active}
          >
            <span className="block truncate">{shortLabels ? shortLanguageLabel(item.value) : t(item.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

function shortLanguageLabel(language: Language): string {
  return language === 'zh-CN' ? '中' : 'EN';
}
