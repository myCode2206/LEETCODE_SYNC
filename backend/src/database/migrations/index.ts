import type { Migration } from 'kysely/migration';
import * as m0001 from './0001_initial.js';
import * as m0002 from './0002_problem_content.js';
import * as m0003 from './0003_login_links.js';

/** Ordered list of migrations. Statically imported so the bundled build needs no file scanning. */
export const migrations: Record<string, Migration> = {
  '0001_initial': m0001,
  '0002_problem_content': m0002,
  '0003_login_links': m0003,
};
