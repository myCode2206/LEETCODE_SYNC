export type CategoryKind = 'topic' | 'pattern';

export type Route =
  | { name: 'dashboard' }
  | { name: 'problems' }
  | { name: 'topics' }
  | { name: 'patterns' }
  | { name: 'revisions' }
  | { name: 'category'; kind: CategoryKind; slug: string; label: string }
  | { name: 'problem'; slug: string };

export type Navigate = (route: Route) => void;

export const TABS: { name: Route['name']; label: string }[] = [
  { name: 'dashboard', label: 'Dashboard' },
  { name: 'problems', label: 'Problems' },
  { name: 'topics', label: 'Topics' },
  { name: 'patterns', label: 'Patterns' },
  { name: 'revisions', label: 'Revisions' },
];
