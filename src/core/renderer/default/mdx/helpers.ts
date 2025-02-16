import { PageProperties } from '../../../../types';

type NotionPropertyValue = PageProperties[string];

// Helper to extract values from Notion property objects using proper types
export function extractPropertyValue(property: NotionPropertyValue): any {
  // If no property, return null
  if (!property) return null;

  // Use type narrowing based on the property type
  switch (property.type) {
    case 'title':
      return property.title[0]?.plain_text || '';

    case 'rich_text':
      return property.rich_text[0]?.plain_text || '';

    case 'select':
      return property.select?.name || '';

    case 'multi_select':
      return property.multi_select.map((item) => item.name);

    case 'date':
      // Handle both single dates and date ranges
      if (!property.date) return '';
      return property.date.end
        ? `${property.date.start} to ${property.date.end}`
        : property.date.start;

    case 'number':
      return property.number ?? 0;

    case 'checkbox':
      return property.checkbox;

    case 'url':
      return property.url || '';

    case 'email':
      return property.email || '';

    case 'phone_number':
      return property.phone_number || '';

    case 'created_time':
      return property.created_time;

    case 'created_by':
      // @ts-ignore
      return property.created_by.name || property.created_by.id;

    case 'last_edited_time':
      return property.last_edited_time;

    case 'last_edited_by':
      // @ts-ignore
      return property.last_edited_by.name || property.last_edited_by.id;

    case 'formula':
      // Handle different formula result types
      switch (property.formula.type) {
        case 'string':
          return property.formula.string || '';
        case 'number':
          return property.formula.number ?? 0;
        case 'boolean':
          return property.formula.boolean;
        case 'date':
          return property.formula.date?.start || '';
      }
      break;

    case 'rollup':
      // Handle different rollup types
      switch (property.rollup.type) {
        case 'number':
          return property.rollup.number ?? 0;
        case 'date':
          return property.rollup.date?.start || '';
        case 'array':
          return property.rollup.array.map((item) =>
            extractPropertyValue(item as NotionPropertyValue),
          );
      }
      break;

    case 'files':
      return property.files.map((file) =>
        // @ts-ignore
        file.type === 'external' ? file.external.url : file.file.url,
      );

    case 'people':
      // @ts-ignore
      return property.people.map((person) => person.name || person.id);

    case 'relation':
      return property.relation.map((item) => item.id);

    default:
      return null;
  }
}

// Helper to format values for YAML frontmatter
export function formatYamlValue(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => `"${v}"`).join(', ')}]`;
  }
  if (typeof value === 'string') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return String(value);
}
