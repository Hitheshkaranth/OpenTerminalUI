import sys


def open_browser():
    import time
    import webbrowser
    time.sleep(2)
    webbrowser.open("http://127.0.0.1:8000")


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if getattr(sys, "frozen", False):
        # Allow both the server and its isolated worker to resolve bundled modules.
        sys.path.insert(0, sys._MEIPASS)
    if args == ["--ot-python-execution-worker"]:
        # Static import lets PyInstaller collect the worker. Dispatch before any
        # uvicorn import or browser thread so child execution cannot launch the app.
        from backend.core.python_execution_worker import main as execute_worker
        execute_worker()
        return
    import threading
    import uvicorn
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    main()
