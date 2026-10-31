// Account UI shared by the main menu and the multiplayer lobby: who you are (callsign or Guest), the sign-in panel
// (username + password; a new name creates the account) and the account dialog (change password, sign out).

import { h, type App } from '../app.ts';
import { sfx } from '../audio.ts';
import { changePassword, currentSession, logout, signedIn, signIn, type SignInStatus } from '../net.ts';
import { syncGarage } from '../sync.ts';
import { openModal, type ModalHandle } from './modal.ts';
import * as kit from './kit.ts';

const PASSWORD_MIN = 4;

/** A callsign from before passwords (this device enlisted without one): signing in with it keeps the account. */
export function legacyCallsign(): string | null {
  const s = currentSession();
  return s && !s.auto && !s.registered ? s.name : null;
}

/** The name to show for the current player: their username when signed in, else "Guest". */
export function accountName(): string {
  return signedIn() ? currentSession()!.name : 'Guest';
}

/**
 * The sign-in form. `onDone` runs after a successful sign-in, once this device's garage has been merged into the
 * account (so the next screen already shows the account's units).
 */
export function signInPanel(app: App, opts: { lead?: string; className?: string; autofocus?: boolean; onDone?: (status: SignInStatus) => void } = {}): HTMLElement {
  const legacy = legacyCallsign();
  const user = kit.textField({
    value: legacy ?? '', maxlength: 16, placeholder: 'Username', label: 'Username', className: 'acct-input',
    attrs: { name: 'username', autocomplete: 'username', minlength: '2', autocapitalize: 'off', 'data-fk': 'acct-user' },
  });
  const pass = kit.textField({
    maxlength: 128, placeholder: `Password (${PASSWORD_MIN}+ characters)`, label: 'Password', className: 'acct-input',
    attrs: { type: 'password', name: 'password', autocomplete: 'current-password', minlength: String(PASSWORD_MIN), 'data-fk': 'acct-pass' },
  });
  const err = h('p.acct-err', { role: 'alert', 'aria-live': 'assertive' });
  const btn = h('button.primary.acct-submit', { type: 'submit' }, 'Sign in');
  let busy = false;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    const name = user.input.value.trim(), pw = pass.input.value;
    err.textContent = '';
    if ([...name].length < 2) { err.textContent = 'Enter a username (2–16 letters or digits).'; user.input.focus(); return; }
    if ([...pw].length < PASSWORD_MIN) { err.textContent = `The password needs at least ${PASSWORD_MIN} characters.`; pass.input.focus(); return; }
    busy = true;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const { session, status } = await signIn(name, pw);
      // merge the units made on this device (as a guest) into the account before anything shows the garage
      await syncGarage();
      sfx('ready');
      app.toast(status === 'registered' ? `Account “${session.name}” created — your units are saved to it.`
        : status === 'claimed' ? `Callsign “${session.name}” is yours now — password set.`
          : `Welcome back, ${session.name}. Your units are synced.`, 'good');
      opts.onDone?.(status);
    } catch (e2) {
      sfx('error');
      err.textContent = e2 instanceof Error ? e2.message : String(e2);
      pass.input.select();
      pass.input.focus();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  };

  const form = h('form.panel.acct-panel', { class: opts.className ?? null, onsubmit: (e: Event) => void submit(e), novalidate: true },
    h('div.panel-title', null, 'Account'),
    h('h3', null, legacy ? `Keep your callsign “${legacy}”` : 'Sign in or create an account'),
    opts.lead ? h('p.muted', null, opts.lead) : null,
    h('div.acct-fields', null, user.el, pass.el),
    err,
    h('div.acct-row', null, btn),
    h('ul.acct-notes', null,
      h('li', null, h('b', null, 'New name?'), ' Signing in with it creates your account with this password.'),
      h('li', null, 'Signed in, your unit designs and deck are kept on the server — sign in with the same name on any device to get them back.'),
      h('li', null, 'Units you designed as a guest on this device are added to your account.'),
      legacy ? h('li', null, `This device used “${legacy}” before passwords existed: sign in with that name to keep it and its matches.`) : null,
    ),
  );
  if (opts.autofocus !== false) setTimeout(() => (legacy ? pass.input : user.input).focus(), 0);
  return form;
}

/** Sign-in dialog (menu). */
export function openSignIn(app: App, onDone?: () => void): ModalHandle {
  let m: ModalHandle | null = null;
  const panel = signInPanel(app, { className: 'acct-in-modal', onDone: () => { m?.close(); onDone?.(); } });
  panel.classList.remove('panel');
  const legacy = legacyCallsign();
  m = openModal(legacy ? `Keep your callsign “${legacy}”` : 'Sign in or create an account', panel);
  m.el.classList.add('acct-modal');
  return m;
}

/** Account dialog for a signed-in player: change password, sign out. */
export function openAccount(app: App, onChange?: () => void): ModalHandle {
  const s = currentSession();
  const cur = kit.textField({ maxlength: 128, placeholder: 'Current password', label: 'Current password', className: 'acct-input', attrs: { type: 'password', autocomplete: 'current-password' } });
  const next = kit.textField({ maxlength: 128, placeholder: `New password (${PASSWORD_MIN}+ characters)`, label: 'New password', className: 'acct-input', attrs: { type: 'password', autocomplete: 'new-password' } });
  const err = h('p.acct-err', { role: 'alert' });
  const pwForm = h('form.acct-pwform', {
    onsubmit: async (e: Event) => {
      e.preventDefault();
      err.textContent = '';
      if ([...next.input.value].length < PASSWORD_MIN) { err.textContent = `The new password needs at least ${PASSWORD_MIN} characters.`; return; }
      try {
        await changePassword(cur.input.value, next.input.value);
        sfx('ready');
        app.toast('Password changed.', 'good');
        m.close();
      } catch (e2) { sfx('error'); err.textContent = e2 instanceof Error ? e2.message : String(e2); }
    },
  },
  h('h4', null, 'Change password'),
  h('input', { type: 'text', name: 'username', autocomplete: 'username', value: s?.name ?? '', hidden: true, 'aria-hidden': 'true' }),
  h('div.acct-fields', null, cur.el, next.el), err,
  h('div.acct-row', null, h('button', { type: 'submit' }, 'Change password')));
  const signOut = h('button.danger', {
    onclick: () => {
      sfx('click');
      logout();
      m.close();
      app.toast('Signed out. Your units stay on this device; sign in again to sync them.', 'info');
      onChange?.();
    },
  }, 'Sign out');
  const m = openModal('Account', h('div.acct-dialog', null,
    h('p', null, 'Signed in as ', h('b.acct-name', null, s?.name ?? '?'), '.'),
    h('p.muted', null, 'Your unit designs and deck are saved to this account. Sign in with the same username and password on another device to use them there.'),
    pwForm,
  ), [signOut]);
  m.el.classList.add('acct-modal');
  return m;
}

/** "Alice · Account" / "Guest · Sign in" chip for headers. */
export function accountChip(app: App, onChange: () => void): HTMLElement {
  const isIn = signedIn();
  return h('div.acct-chip', { class: isIn ? 'in' : 'guest' },
    h('span.acct-who', null,
      h('small', null, isIn ? 'Signed in as' : 'Playing as'),
      h('b', { title: isIn ? 'Your username' : 'Not signed in: units are kept on this device only' }, accountName())),
    isIn
      ? h('button.acct-link', { type: 'button', onclick: () => { sfx('click'); openAccount(app, onChange); } }, 'Account')
      : h('button.acct-link.primary', { type: 'button', onclick: () => { sfx('click'); openSignIn(app, onChange); } }, 'Sign in'),
  );
}
