"""ekorn launcher.

Runs the ekorn core binary when it is installed. Without the core, ``ekorn hook``
is a silent no-op (so agent hooks keep working unchanged) and other commands
explain where to get the core.
"""
import os
import sys

__version__ = "0.1.0"
RELEASES = "https://github.com/ekornhq/ekorn/releases"


def core_path() -> str:
    if os.environ.get("EKORN_CORE"):
        return os.environ["EKORN_CORE"]
    home = os.environ.get("EKORN_HOME") or os.path.join(os.path.expanduser("~"), ".ekorn")
    exe = "ekorn-core.exe" if os.name == "nt" else "ekorn-core"
    return os.path.join(home, "bin", exe)


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    core = core_path()
    have_core = os.path.isfile(core) and os.access(core, os.X_OK)

    # --version prints both halves so a bug report can say which core and which shim are in play.
    if args[:1] in (["--version"], ["-V"], ["version"]):
        if have_core:
            import subprocess

            subprocess.call([core, "--version"])
        else:
            print(f"ekorn-core: not installed (expected at {core})")
        print(f"ekorn shim {__version__} (pypi)")
        return 0

    if have_core:
        if os.name == "nt":
            import subprocess

            return subprocess.call([core, *args])
        os.execv(core, [core, *args])

    if args[:1] == ["hook"]:
        return 0
    sys.stderr.write(
        f"ekorn: core binary not found at {core}\n"
        f"Download ekorn-core for your platform from {RELEASES}, verify it against sha256sums.txt,\n"
        "make it executable and place it there, or point EKORN_CORE at it.\n"
    )
    return 2
