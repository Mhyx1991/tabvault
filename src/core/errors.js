// Typed errors + friendly user-facing messages.
// Technical detail stays in the console; users only ever see these strings.

export class TvError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'TvError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export const MESSAGES = {
  STORAGE_UNAVAILABLE:
    "We couldn't reach TabVault's local database. Snapshots, undo and workspaces are unavailable right now, but your tabs have not been changed.",
  SNAPSHOT_FAILED:
    "We couldn't save a safety snapshot, so the action was cancelled. Your tabs are unchanged.",
  ORGANIZE_PARTIAL:
    'Some groups could not be created. Everything else was organized, and your original layout is one Undo away.',
  IMPORT_INVALID:
    "This backup couldn't be imported. Your existing TabVault data is unchanged.",
  NO_UNDO:
    "There's no recent organization to undo.",
  NOT_FOUND: "That item no longer exists — it may have been deleted.",
  CLOSE_FAILED:
    "Some tabs couldn't be closed (Chrome protects certain pages). Nothing else was changed."
};

export function friendly(err) {
  if (err instanceof TvError) return MESSAGES[err.code] || err.message;
  if (err && typeof err.message === 'string') {
    if (/IndexedDB|IDB|Database/i.test(err.message)) return MESSAGES.STORAGE_UNAVAILABLE;
    return err.message;
  }
  return "We couldn't save this change. Your existing tabs have not been changed.";
}

/** Log technical details for debugging without bothering the user. */
export function logError(where, err) {
  console.warn(`[TabVault] ${where}:`, err);
}
