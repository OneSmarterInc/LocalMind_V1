import argparse, configparser, json, os, ssl, sys, time, urllib.error, urllib.request, webbrowser
from pathlib import Path

DEFAULT_SERVER = "https://localmind.taild0af72.ts.net"
INI_NAME = "LocalMind.ini"
HEALTH_PATH = "/api/health/"

def here():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent

def normalise(url):
    url = (url or "").strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url

def from_ini():
    path = here() / INI_NAME
    if not path.is_file():
        return ""
    parser = configparser.ConfigParser()
    try:
        parser.read(path, encoding="utf-8")
    except Exception as exc:
        print("  (ignoring %s: %s)" % (INI_NAME, exc))
        return ""
    return parser.get("localmind", "server", fallback="")

def resolve_server(cli):
    for candidate in (cli, os.environ.get("LOCALMIND_SERVER", ""), from_ini(), DEFAULT_SERVER):
        url = normalise(candidate)
        if url:
            return url
    return ""

def check_health(server):
    req = urllib.request.Request(server + HEALTH_PATH, headers={"User-Agent": "LocalMindLauncher/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=ssl.create_default_context()) as resp:
            body = resp.read(8192).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return True, "reachable (HTTP %s)" % exc.code
    except Exception as exc:
        return False, str(getattr(exc, "reason", exc))
    try:
        payload = json.loads(body)
    except ValueError:
        return True, "reachable"
    return True, "status: %s" % (payload.get("status") or "ok")

def main():
    ap = argparse.ArgumentParser(prog="LocalMind Launcher")
    ap.add_argument("--server", default="")
    ap.add_argument("--no-check", action="store_true")
    ap.add_argument("--print-config", action="store_true")
    args = ap.parse_args()

    server = resolve_server(args.server)
    print("\n  LocalMind")
    print("  Server: %s\n" % (server or "(not configured)"))

    if args.print_config:
        print("  ini file : %s" % (here() / INI_NAME))
        print("  exists   : %s" % (here() / INI_NAME).is_file())
        return 0

    if not server:
        print("  No server address configured. Create %s next to this exe:\n" % INI_NAME)
        print("    [localmind]")
        print("    server = https://your-server-address\n")
        input("  Press Enter to close. ")
        return 2

    if not args.no_check:
        print("  Checking the server is up...")
        ok, detail = check_health(server)
        if not ok:
            print("\n  Could not reach %s" % server)
            print("  Reason: %s\n" % detail)
            print("  Check, in this order:")
            print("    1. The server laptop is awake and both its windows are open.")
            print("    2. The address changed. Edit %s next to this exe." % INI_NAME)
            print("    3. Your network blocks it. Try a phone hotspot.")
            print("    4. The server is still starting. Wait a minute.\n")
            if input("  Open the browser anyway? [y/N] ").strip().lower() not in ("y", "yes"):
                return 1
        else:
            print("  Server is up (%s)." % detail)

    print("  Opening your browser...\n")
    if not webbrowser.open(server):
        print("  Could not start a browser. Open this by hand:\n\n    %s\n" % server)
        input("  Press Enter to close. ")
        return 1
    print("  Done. You can close this window.")
    time.sleep(4)
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
