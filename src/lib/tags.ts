import type { CSSProperties } from 'react';
import { DEFAULT_TAGS } from './db';

export const TAG_PALETTE = ['#3B82F6', '#22C55E', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4', '#10B981', '#F97316', '#111827', '#EF4444'];

const DEFAULT_TAG_COLORS: Record<string, string> = {
  工作: '#3B82F6',
  个人: '#22C55E',
  代码: '#8B5CF6',
  学习: '#F59E0B',
  灵感: '#EC4899',
  项目: '#06B6D4',
  读书: '#10B981',
  会议: '#F97316',
  AI: '#111827',
  设计: '#EF4444',
};

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    next.push(tag);
  }
  return next;
}

export function defaultTagColor(tag: string): string {
  const fallbackIndex = Math.max(0, DEFAULT_TAGS.indexOf(tag));
  return DEFAULT_TAG_COLORS[tag] || TAG_PALETTE[fallbackIndex % TAG_PALETTE.length] || TAG_PALETTE[0];
}

export function getTagColor(tag: string, tagColors: Record<string, string>): string {
  return tagColors[tag] || defaultTagColor(tag);
}

export function tagDotStyle(tag: string, tagColors: Record<string, string>): CSSProperties {
  return {
    backgroundColor: getTagColor(tag, tagColors),
  };
}

export function tagPillStyle(tag: string, tagColors: Record<string, string>, mode: 'soft' | 'solid' = 'soft'): CSSProperties {
  const color = getTagColor(tag, tagColors);
  if (mode === 'solid') {
    return {
      backgroundColor: color,
      borderColor: color,
      color: '#ffffff',
    };
  }
  return {
    backgroundColor: tint(color, 0.88),
    borderColor: tint(color, 0.58),
    color,
  };
}

function tint(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return hex;
  }

  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
