"""Standard-library-only child process for the validated Python execution route.

Run as a script with isolated Python (-I). The parent validates the source and
terminates this process at the deadline; user stdout never redirects the server.
"""
from __future__ import annotations

import builtins
import contextlib
import io
import json
import sys
import traceback

# Hard caps applied to every sandboxed child process (POSIX only).
MAX_OUTPUT_BYTES = 1_000_000
MEMORY_LIMIT_BYTES = 1 << 30  # RLIMIT_AS 1 GiB


def child_resource_limiter(cpu_seconds: int):
    """Return a preexec_fn applying RLIMIT_AS/RLIMIT_CPU in the child, or None.

    Non-POSIX platforms (no ``resource`` module / no preexec_fn support) get None
    and rely on the parent's wall-clock kill. Limits the platform refuses (macOS
    rejects RLIMIT_AS) are skipped rather than failing the launch.
    """
    try:
        import resource
    except ImportError:
        return None
    if sys.platform == "win32":
        return None
    cpu = max(1, int(cpu_seconds))

    def _apply() -> None:
        for limit, value in ((resource.RLIMIT_AS, MEMORY_LIMIT_BYTES), (resource.RLIMIT_CPU, cpu)):
            try:
                resource.setrlimit(limit, (value, value))
            except (ValueError, OSError):
                pass

    return _apply


def main():
    request = json.loads(sys.stdin.read())
    allowed = {name: getattr(builtins, name) for name in request["builtins"]}
    scope = {"__builtins__": allowed}
    variables = {}
    output = io.StringIO()
    response = {"stdout": "", "stderr": "", "result": None, "timed_out": False}
    try:
        with contextlib.redirect_stdout(output):
            exec(request["code"], scope, variables)
        response["result"] = variables.get("result")
    except Exception:
        response["stderr"] = traceback.format_exc(limit=1)
    response["stdout"] = output.getvalue()
    if len(response["stdout"]) > MAX_OUTPUT_BYTES:
        response["stdout"] = response["stdout"][:MAX_OUTPUT_BYTES] + "\n[output truncated at 1MB]"
    # Match the JSON response behavior for ordinary Python collections.
    def serializable(value):
        if isinstance(value, (set, frozenset, range)):
            return list(value)
        raise TypeError(f"Result of type {type(value).__name__} is not JSON serializable")
    try:
        encoded = json.dumps(response, default=serializable, allow_nan=False)
    except (ValueError, TypeError):
        response["result"] = None
        response["stderr"] = traceback.format_exc(limit=1)
        encoded = json.dumps(response)
    if len(encoded) - len(json.dumps(response["stdout"])) > MAX_OUTPUT_BYTES:
        response["result"] = None
        response["stderr"] = "Result exceeded the 1MB output limit"
        encoded = json.dumps(response)
    sys.stdout.write(encoded)


if __name__ == "__main__":
    main()
