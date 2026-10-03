/** Fields a research export can include. Shared by server and client code. */
export const EXPORT_FIELDS = ['protocol', 'versions', 'predictions', 'sessions', 'events', 'comments', 'evidence', 'interventions', 'comparisons'] as const;
export type ExportField = (typeof EXPORT_FIELDS)[number];
