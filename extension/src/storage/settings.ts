/** Settings that only affect the extension (repository generation settings live on the backend). */
export interface ExtensionSettings {
  /** Sync accepted submissions without asking. */
  autoSync: boolean;
  /** Also record non-accepted submissions (stats only; their code is never uploaded). */
  syncFailedSubmissions: boolean;
  /** Create a GitHub commit right away; otherwise record and push later. */
  commitAutomatically: boolean;
  /** Show "Save as attempt" for accepted submissions. */
  saveAttemptHistory: boolean;
  /** Desktop notification after each sync. */
  notifications: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  autoSync: true,
  syncFailedSubmissions: false,
  commitAutomatically: true,
  saveAttemptHistory: false,
  notifications: true,
};
