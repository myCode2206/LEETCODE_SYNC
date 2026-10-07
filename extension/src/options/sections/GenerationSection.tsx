import { useState } from 'react';
import { DEFAULT_COMMIT_TEMPLATE } from '@lcsync/shared';
import type { RepositoryConfigDto, RepositorySettings } from '@lcsync/shared';
import { Banner, Button, Toggle } from '../../components/ui.js';
import { useRepositorySettings } from '../useRepositorySettings.js';

/** Mirrors the backend's template rendering for a live preview. */
function preview(template: string, kind: 'add' | 'improve' | 'language'): string {
  const values: Record<string, string> = {
    action: kind === 'improve' ? 'improve' : 'add',
    id: '1',
    title: 'Two Sum',
    slug: 'two-sum',
    difficulty: 'Easy',
    language: kind === 'language' ? 'C++' : 'Python',
    languageSuffix: kind === 'language' ? ' (C++)' : '',
  };
  return template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
}

const TOGGLES: { key: keyof RepositorySettings; title: string; description: string }[] = [
  {
    key: 'generateReadme',
    title: 'Generate README',
    description: 'Maintains a progress section in the root README.md (your own text is preserved).',
  },
  {
    key: 'generateTopicIndexes',
    title: 'Generate topic indexes',
    description: 'topics/array.md, topics/hash-table.md … linking to each problem folder.',
  },
  {
    key: 'generatePatternIndexes',
    title: 'Generate pattern indexes',
    description: 'patterns/sliding-window.md … from the patterns you assign.',
  },
  {
    key: 'generateDifficultyIndexes',
    title: 'Generate difficulty indexes',
    description: 'difficulty/easy.md, medium.md, hard.md.',
  },
  {
    key: 'generateLanguageIndexes',
    title: 'Generate language indexes',
    description: 'languages/python.md … linking to each solution file.',
  },
  {
    key: 'generateStats',
    title: 'Generate statistics',
    description: 'stats/stats.json with machine-readable counts.',
  },
  {
    key: 'suggestPatternsFromTopics',
    title: 'Suggest patterns from LeetCode topics',
    description:
      'When a problem is first solved, topics that are patterns (e.g. "Sliding Window", "Union Find") become patterns. Nothing else is guessed.',
  },
];

export function GenerationSection({ repository }: { repository: RepositoryConfigDto }) {
  const { save, saving, error } = useRepositorySettings();
  const s = repository.settings;
  const [template, setTemplate] = useState(s.commitMessageTemplate);

  return (
    <section className="card" id="generation">
      <h2>Repository files</h2>
      <p className="lead">
        Which files the extension maintains. Changes apply from the next sync; use "Rebuild
        repository" to apply them now.
      </p>
      {TOGGLES.map((t) => (
        <Toggle
          key={t.key}
          checked={Boolean(s[t.key])}
          disabled={saving}
          onChange={(v) => void save({ [t.key]: v })}
          title={t.title}
          description={t.description}
        />
      ))}

      <div
        className="stack tight"
        style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}
      >
        <label className="field">
          <span>Commit message format</span>
          <input
            className="input mono"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
        </label>
        <div className="small muted">
          Placeholders: <code>{'{action}'}</code> <code>{'{id}'}</code> <code>{'{title}'}</code>{' '}
          <code>{'{slug}'}</code> <code>{'{difficulty}'}</code> <code>{'{language}'}</code>{' '}
          <code>{'{languageSuffix}'}</code>
        </div>
        <div className="preview">
          {preview(template, 'add')}
          <br />
          {preview(template, 'improve')}
          <br />
          {preview(template, 'language')}
        </div>
        <div className="row">
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={template === s.commitMessageTemplate}
            onClick={() => void save({ commitMessageTemplate: template })}
          >
            Save format
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTemplate(DEFAULT_COMMIT_TEMPLATE)}>
            Reset to default
          </Button>
        </div>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
    </section>
  );
}
