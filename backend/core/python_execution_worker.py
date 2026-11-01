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
    sys.stdout.write(encoded)


if __name__ == "__main__":
    main()
