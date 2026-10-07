import { useEffect } from 'react';
import { useStorage } from '../hooks/useStorage.js';
import { api } from '../services/api.js';
import { chromeStorage } from '../storage/storage.js';
import { AccountSection } from './sections/AccountSection.js';
import { GenerationSection } from './sections/GenerationSection.js';
import { MaintenanceSection } from './sections/MaintenanceSection.js';
import { PrivacySection } from './sections/PrivacySection.js';
import { RepositorySection } from './sections/RepositorySection.js';
import { SyncSection } from './sections/SyncSection.js';

const storage = chromeStorage();

export function OptionsApp() {
  const [session] = useStorage('session');
  const [me] = useStorage('me');

  useEffect(() => {
    if (session)
      void api
        .me()
        .then((fresh) => storage.set('me', fresh))
        .catch(() => undefined);
  }, [session]);

  const connected = !!session && !!me?.github;
  return (
    <div className="options">
      <header className="stack tight">
        <h1>LeetCode → GitHub Sync</h1>
        <nav className="toc">
          <a href="#github">GitHub</a>
          <a href="#repository">Repository</a>
          <a href="#sync">Sync</a>
          <a href="#generation">Repository files</a>
          <a href="#maintenance">Queue &amp; maintenance</a>
          <a href="#privacy">Privacy</a>
        </nav>
      </header>
      <AccountSection me={me ?? null} />
      {connected && me && <RepositorySection me={me} />}
      <SyncSection me={me ?? null} />
      {connected && me?.repository && <GenerationSection repository={me.repository} />}
      <MaintenanceSection connected={connected && !!me?.repository} />
      <PrivacySection />
    </div>
  );
}
