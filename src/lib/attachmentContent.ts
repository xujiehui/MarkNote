import type { ImageAttachment } from '../types';

export const ATTACHMENT_REF_PREFIX = 'marknote-attachment://';

export function attachmentRefUrl(attachmentId: string): string {
  return `${ATTACHMENT_REF_PREFIX}${encodeURIComponent(attachmentId)}`;
}

export function attachmentIdFromRefUrl(value: string | undefined | null): string {
  if (!value?.startsWith(ATTACHMENT_REF_PREFIX)) {
    return '';
  }
  return decodeURIComponent(value.slice(ATTACHMENT_REF_PREFIX.length));
}

export function replaceAttachmentDataUrlsWithRefs(content: string): string {
  return transformAttachmentContent(content, ({ element, attachmentId, attribute }) => {
    const value = element.getAttribute(attribute) || '';
    if (value.startsWith('data:')) {
      element.setAttribute(attribute, attachmentRefUrl(attachmentId));
    }
  });
}

export function restoreAttachmentRefs(content: string, attachments: Iterable<ImageAttachment>): string {
  const dataById = new Map(
    Array.from(attachments)
      .filter((attachment) => Boolean(attachment.data))
      .map((attachment) => [attachment.id, attachment.data]),
  );
  if (!dataById.size) {
    return content;
  }

  return transformAttachmentContent(content, ({ element, attachmentId, attribute }) => {
    const value = element.getAttribute(attribute) || '';
    const data = dataById.get(attachmentId);
    if (data && attachmentIdFromRefUrl(value) === attachmentId) {
      element.setAttribute(attribute, data);
    }
  });
}

export function extractAttachmentRefIds(content: string): Set<string> {
  const ids = new Set<string>();
  transformAttachmentContent(content, ({ element, attribute }) => {
    const id = attachmentIdFromRefUrl(element.getAttribute(attribute));
    if (id) {
      ids.add(id);
    }
  });
  return ids;
}

function transformAttachmentContent(
  content: string,
  transform: (target: { element: Element; attachmentId: string; attribute: string }) => void,
): string {
  if (!content || typeof DOMParser === 'undefined') {
    return content;
  }

  const doc = new DOMParser().parseFromString(content, 'text/html');
  let changed = false;
  doc.querySelectorAll('[data-attachment-id]').forEach((element) => {
    const attachmentId = element.getAttribute('data-attachment-id') || '';
    const attribute = attachmentSourceAttribute(element);
    if (!attachmentId || !attribute) {
      return;
    }
    const before = element.getAttribute(attribute);
    transform({ element, attachmentId, attribute });
    changed = changed || before !== element.getAttribute(attribute);
  });

  return changed ? doc.body.innerHTML : content;
}

function attachmentSourceAttribute(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (tag === 'img' || tag === 'video' || tag === 'audio') {
    return 'src';
  }
  if (tag === 'file-attachment') {
    return 'href';
  }
  return '';
}
