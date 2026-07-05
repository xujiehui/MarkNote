import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';

export interface ImageAttrs {
  src: string;
  alt?: string;
  title?: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  attachmentId?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    resizableImage: {
      setImageAlign: (align: 'left' | 'right' | 'center') => ReturnType;
      setImageWidth: (width: string) => ReturnType;
    };
  }
}

export const ResizableImage = Image.extend({
  name: 'image',

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: '65%',
        parseHTML: (element) => element.getAttribute('width') || element.style.width || '65%',
        renderHTML: (attributes) => ({
          width: attributes.width,
          style: `width: ${attributes.width};`,
        }),
      },
      align: {
        default: 'left',
        parseHTML: (element) => element.getAttribute('data-align') || 'left',
        renderHTML: (attributes) => ({
          'data-align': attributes.align,
          class: `image-${attributes.align}`,
        }),
      },
      attachmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes) =>
          attributes.attachmentId
            ? {
                'data-attachment-id': attributes.attachmentId,
              }
            : {},
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageAlign:
        (align) =>
        ({ commands }) =>
          commands.updateAttributes('image', { align }),
      setImageWidth:
        (width) =>
        ({ commands }) =>
          commands.updateAttributes('image', { width }),
    };
  },
});
