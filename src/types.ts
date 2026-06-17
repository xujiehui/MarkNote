export interface Note {
  id: string;
  title: string;
  content: string;
  rawContent?: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  pinned: boolean;
  deletedAt?: number | null;
}

export interface ImageAttachment {
  id: string;
  noteId: string;
  data: string;
  mimeType: string;
}

export type ExportFormat = 'html' | 'pdf' | 'markdown' | 'json';

export type TagFilter = 'all' | 'trash' | string;

export interface ImportResult {
  title: string;
  content: string;
  note?: Note;
  tags?: string[];
}
