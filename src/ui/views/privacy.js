// Privacy — plain-language transparency. No telemetry exists to hide.

import { el, card, sectionHead, badge } from '../components.js';
import { store } from '../store.js';

export async function render(root) {
  root.appendChild(sectionHead('Privacy', badge('Local-only', 'success')));
  root.appendChild(el('p', { class: 'section-sub', style: 'margin:-6px 0 16px', text: 'Your browsing data stays on your device.' }));

  const c = card('card-pad prose');

  c.appendChild(el('h3', { text: 'What TabVault stores' }));
  c.appendChild(el('p', { text: 'TabVault keeps everything in your browser profile, on this device only:' }));
  c.appendChild(el('ul', {},
    el('li', { text: 'Settings and your custom domain rules.' }),
    el('li', { text: 'Snapshots — the lists of open tabs and windows used for Undo and History.' }),
    el('li', { text: 'Workspaces you choose to save.' })
  ));

  c.appendChild(el('h3', { text: 'What leaves your device' }));
  c.appendChild(el('p', { text: 'Nothing. TabVault has no server, no account and no analytics. It makes no network requests of its own. Exports happen only when you explicitly save a file, and go wherever you put it.' }));

  c.appendChild(el('h3', { text: 'How analysis works' }));
  c.appendChild(el('p', { text: 'Grouping suggestions are produced by a deterministic engine that looks at page titles, URLs, domains and existing Chrome tab groups — locally. Page contents are never read, and tabs are never sent anywhere.' }));

  c.appendChild(el('h3', { text: 'Permissions and why' }));
  c.appendChild(el('ul', {},
    el('li', { text: 'tabs — read tab titles and URLs so TabVault can group, search, and snapshot them; create/activate tabs when you ask.' }),
    el('li', { text: 'tabGroups — create and rename Chrome tab groups, and respect the ones you already have.' }),
    el('li', { text: 'storage — save your settings on your device.' }),
    el('li', { text: 'alarms — take periodic snapshots if you enable that option.' }),
    el('li', { text: 'favicon — show site icons next to tabs in the TabVault UI.' })
  ));
  c.appendChild(el('p', { text: 'Incognito windows are never captured in snapshots, even if you allow TabVault to run in incognito.' }));

  c.appendChild(el('h3', { text: 'What TabVault will never do' }));
  c.appendChild(el('ul', {},
    el('li', { text: 'Sell or share browsing data — there is no channel to do so.' }),
    el('li', { text: 'Close a tab without your explicit confirmation.' }),
    el('li', { text: 'Require an account to organize your tabs.' }),
    el('li', { text: 'Upload your URLs to any TabVault server.' })
  ));

  c.appendChild(el('h3', { text: 'Optional AI, later' }));
  c.appendChild(el('p', { text: 'If an AI assist is ever added, it will be off by default, will run only on text you explicitly choose to share, and will be clearly disclosed before the first use. The core organizer works without it.' }));

  root.appendChild(c);
}
