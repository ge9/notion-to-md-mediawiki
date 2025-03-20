import { NotionAnnotationType } from '../../../../types/notion';
import { AnnotationTransformer } from '../../../../types/renderer';

export const annotationTransformers: Partial<
  Record<NotionAnnotationType, AnnotationTransformer>
> = {
  bold: {
    transform: async ({ text, metadata }) =>
      !metadata?.html ? `**${text}**` : `<strong>${text}</strong>`,
  },

  italic: {
    transform: async ({ text, metadata }) =>
      !metadata?.html ? `*${text}*` : `<i>${text}</i>`,
  },

  strikethrough: {
    transform: async ({ text, metadata }) =>
      !metadata?.html ? `~~${text}~~` : `<strike>${text}</strike>`,
  },

  code: {
    transform: async ({ text, metadata }) =>
      metadata?.html ? `<code>${text}</code>` : `\`${text}\``,
  },

  underline: {
    transform: async ({ text }) => `<u>${text}</u>`,
  },

  link: {
    transform: async ({ text, link, metadata }) => {
      if (!link?.url) return text;
      return !metadata?.html
        ? `[${text}](${link.url})`
        : `<a href="${link.url}">${text}</a>`;
    },
  },

  equation: {
    transform: async ({ text, metadata }) => {
      if (!metadata?.html) return `$${text}$`;
      return `<code>${text}</code>`;
    },
  },
};
