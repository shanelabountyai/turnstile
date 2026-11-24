// PRD-2 item 5 (D-65): a missing permission as words on the form, not the app's error page.
//
// The template's `orgAction` turns a `Refused` into `{ error }`, but its guard (`requireOrg`) runs before that and
// throws `AuthzError` for a role without the permission. Uncaught in a server action, that is an HTTP 500 and
// `src/app/error.tsx` in place of the whole org layout (review UX-5, A11Y-1, CODE-4). `refusingInline` wraps an action
// built by `orgAction` and returns `{ error: message }` for that one throw, which `ActionForm` shows inline.
//
// What it does not change: the guard is still `requireOrg(slug, perm)`, so nothing runs for a refused role (no parse,
// no body, no write); a non-member is still notFound and a signed-out caller is still sent to sign in (both are
// navigation signals, not AuthzError, and pass straight through); and the `spec` rides on the export unchanged, so
// the INV-01..04/22 harness drives the action exactly as before.
//
// Two things to know before reusing it (review, 2026-11-24). (1) It answers every AuthzError with the one message it
// was given, including one thrown from inside the action's body, so wrap only an action whose body calls nothing that
// checks a different permission (setEventClock's does not). (2) A refused post is now an HTTP 200 with no server log
// line, where the throw used to leave a logged 500.
import type { ActionSpec, Failure } from '@/core/authz/action';
import { AuthzError } from '@/core/authz/guards';

/** Who can move the event clock (D-35: `org.update`, which owner and admin hold). Shown on the Event page and returned by the action. */
export const CLOCK_MOVERS = 'Only the organisation’s owner or an admin can move the event clock.';

export function refusingInline<A extends unknown[], R>(action: ((...args: A) => Promise<R>) & { spec: ActionSpec }, message: string) {
  const refusing = async (...args: A): Promise<R | Failure> => {
    try {
      return await action(...args);
    } catch (e) {
      if (e instanceof AuthzError) return { error: message };
      throw e;
    }
  };
  return Object.assign(refusing, { spec: action.spec });
}
