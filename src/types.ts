export interface Note {
  id: string;
  title: string;
  content: string;
  rawContent?: string;
  folderId: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  pinned: boolean;
  deletedAt?: number | null;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
}

export interface ImageAttachment {
  id: string;
  noteId: string;
  data: string;
  mimeType: string;
}

export type ExportFormat = 'html' | 'pdf' | 'markdown' | 'json';

export type WorkspaceFilter = 'all' | 'trash' | `folder:${string}` | `tag:${string}`;

export interface ImportResult {
  title: string;
  content: string;
  note?: Note;
  tags?: string[];
}
