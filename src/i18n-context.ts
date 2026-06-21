import { createContext } from 'react';

export type Language = 'zh-CN' | 'en';

export interface I18nContextValue {
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
