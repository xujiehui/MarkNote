import { useContext } from 'react';
import type { Folder } from './types';
import { I18nContext, type I18nContextValue, type Language } from './i18n-context';

export type { Language };

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider.');
  }
  return context;
}

export function getFolderDisplayName(folder: Folder, t: I18nContextValue['t']): string {
  if (folder.id === 'folder-library' && isDefaultName(folder.name, ['资料库', 'Library'])) {
    return t('folder.library');
  }
  if (folder.id === 'folder-code-snippets' && isDefaultName(folder.name, ['代码片段', 'Code snippets'])) {
    return t('folder.codeSnippets');
  }
  if (folder.id === 'folder-archive' && isDefaultName(folder.name, ['归档', 'Archive'])) {
    return t('folder.archive');
  }
  return folder.name;
}

export function getTagDisplayName(tag: string, t: I18nContextValue['t']): string {
  if (tag === '工作' || tag === 'Work') {
    return t('tag.work');
  }
  if (tag === '个人' || tag === 'Personal') {
    return t('tag.personal');
  }
  if (tag === '代码' || tag === '代码片段' || tag === 'Code' || tag === 'Code snippets') {
    return t('tag.code');
  }
  if (tag === '学习' || tag === 'Learning') {
    return t('tag.learning');
  }
  if (tag === '灵感' || tag === 'Ideas') {
    return t('tag.ideas');
  }
  if (tag === '项目' || tag === 'Projects') {
    return t('tag.projects');
  }
  if (tag === '读书' || tag === 'Reading') {
    return t('tag.reading');
  }
  if (tag === '会议' || tag === 'Meetings') {
    return t('tag.meetings');
  }
  if (tag === 'AI') {
    return t('tag.ai');
  }
  if (tag === '设计' || tag === 'Design') {
    return t('tag.design');
  }
  return tag;
}

function isDefaultName(name: string, defaults: string[]): boolean {
  return defaults.includes(name.trim());
}
