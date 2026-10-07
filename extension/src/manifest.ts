/** Builds manifest.json. Host permissions are limited to LeetCode and the configured backend. */
export interface ManifestOptions {
  version: string;
  apiBaseUrl: string;
  /** Optional public key so unpacked builds keep a stable extension ID (for OAuth redirects). */
  publicKey?: string;
}

export function buildManifest({
  version,
  apiBaseUrl,
  publicKey,
}: ManifestOptions): Record<string, unknown> {
  const apiOrigin = new URL(apiBaseUrl).origin;
  const icons = {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  };
  return {
    manifest_version: 3,
    name: 'LeetCode → GitHub Sync',
    short_name: 'LC Sync',
    version,
    description:
      'Syncs accepted LeetCode solutions to an organized GitHub repository and tracks your DSA revisions.',
    minimum_chrome_version: '111',
    icons,
    action: {
      default_popup: 'popup/index.html',
      default_icon: icons,
      default_title: 'LeetCode → GitHub Sync',
    },
    options_ui: { page: 'options/index.html', open_in_tab: true },
    background: { service_worker: 'background.js', type: 'module' },
    // storage: queue/settings · alarms: retry · notifications: sync results · identity: GitHub sign-in
    permissions: ['storage', 'alarms', 'notifications', 'identity'],
    host_permissions: ['https://leetcode.com/*', `${apiOrigin}/*`],
    content_scripts: [
      {
        // Runs in the page context to observe LeetCode's own submission requests (read-only).
        matches: ['https://leetcode.com/*'],
        js: ['content/page-hook.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        matches: ['https://leetcode.com/*'],
        js: ['content/leetcode-bridge.js'],
        run_at: 'document_start',
      },
    ],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
    ...(publicKey ? { key: publicKey } : {}),
  };
}
