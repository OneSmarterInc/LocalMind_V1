/**
 * Where each role works. The one place that maps a role to its workspace, used
 * by the root route, the not-found route and the password screen so they cannot
 * drift apart.
 *
 * An unrecognised role returns null rather than a guess. Guessing "/admin"
 * sent any unexpected role to a route its guard refuses, which fell through
 * to not-found, which guessed "/admin" again: an endless redirect with no
 * error on screen. That can happen when a saved profile from an older build
 * is restored while the server is unreachable.
 */
export type Home = "/student" | "/manage" | "/admin";
export function homeFor(role: unknown): Home | null {
  return role === "student" ? "/student" : role === "faculty" ? "/manage" : role === "admin" ? "/admin" : null;
}
