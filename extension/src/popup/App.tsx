import { useEffect, useState } from 'react';
import { ConnectGitHub } from '../components/ConnectGitHub.js';
import { Button, Spinner } from '../components/ui.js';
import { useStorage } from '../hooks/useStorage.js';
import { api } from '../services/api.js';
import { chromeStorage } from '../storage/storage.js';
import { DataProvider, useData } from './data.js';
import { TABS } from './routes.js';
import type { Route } from './routes.js';
import { CategoriesView } from './views/CategoriesView.js';
import { CategoryRevision } from './views/CategoryRevision.js';
import { Dashboard } from './views/Dashboard.js';
import { ProblemDetail } from './views/ProblemDetail.js';
import { ProblemsView } from './views/ProblemsView.js';
import { RevisionsView } from './views/RevisionsView.js';

const storage = chromeStorage();

export function App() {
  const [session] = useStorage('session');

  if (session === undefined) {
    return (
      <div className="popup-body">
        <Spinner />
      </div>
    );
  }
  if (session === null) return <Welcome />;
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}

function Welcome() {
  return (
    <div className="popup">
      <header className="popup-header">
        <h1>LeetCode → GitHub Sync</h1>
      </header>
      <div className="popup-body stack">
        <p className="muted" style={{ margin: 0 }}>
          Every accepted LeetCode solution is committed to your own GitHub repository — one folder
          per problem, with topic, pattern, difficulty and language indexes — and tracked for
          revision.
        </p>
        <ConnectGitHub />
      </div>
    </div>
  );
}

function Shell() {
  const [me] = useStorage('me');
  const [route, setRoute] = useState<Route>({ name: 'dashboard' });
  const [history, setHistory] = useState<Route[]>([]);
  const { loading, refresh } = useData();

  // Restore the last tab and refresh account state.
  useEffect(() => {
    void storage.get('popupTab').then((tab) => {
      if (TABS.some((t) => t.name === tab)) setRoute({ name: tab } as Route);
    });
    void api
      .me()
      .then((fresh) => storage.set('me', fresh))
      .catch(() => undefined);
  }, []);

  const navigate = (next: Route) => {
    setHistory((h) => [...h, route]);
    setRoute(next);
    if (TABS.some((t) => t.name === next.name)) void storage.set('popupTab', next.name);
  };
  const back = () => {
    setRoute(history.at(-1) ?? { name: 'dashboard' });
    setHistory((h) => h.slice(0, -1));
  };
  const activeTab = TABS.some((t) => t.name === route.name) ? route.name : null;

  const github = me?.github;
  const dot = !github || github.needsReconnect ? 'error' : !me?.repository ? 'warn' : 'ok';
  const statusText = !github
    ? 'GitHub not connected'
    : github.needsReconnect
      ? 'GitHub needs reconnecting'
      : me?.repository
        ? `${me.repository.fullName} · ${me.repository.branch}`
        : 'No repository selected';

  return (
    <div className="popup">
      <header className="popup-header">
        <span className={`status-dot ${dot}`} title={statusText} />
        <div className="grow">
          <h1>LeetCode Sync</h1>
          <div className="small muted truncate">{statusText}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          loading={loading}
          aria-label="Refresh"
        >
          ↻
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void chrome.runtime.openOptionsPage()}
          aria-label="Settings"
        >
          ⚙ Settings
        </Button>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.name}
            type="button"
            aria-current={activeTab === t.name ? 'page' : undefined}
            onClick={() => {
              setHistory([]);
              navigate({ name: t.name } as Route);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="popup-body">
        {route.name === 'dashboard' && <Dashboard navigate={navigate} />}
        {route.name === 'problems' && <ProblemsView navigate={navigate} />}
        {route.name === 'topics' && <CategoriesView kind="topic" navigate={navigate} />}
        {route.name === 'patterns' && <CategoriesView kind="pattern" navigate={navigate} />}
        {route.name === 'revisions' && <RevisionsView navigate={navigate} />}
        {route.name === 'category' && (
          <CategoryRevision route={route} navigate={navigate} back={back} />
        )}
        {route.name === 'problem' && <ProblemDetail slug={route.slug} back={back} />}
      </main>
    </div>
  );
}
