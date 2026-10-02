import uvicorn
import webbrowser
import threading
import time
import sys
import os

def open_browser():
    time.sleep(2)
    webbrowser.open("http://127.0.0.1:8000")

if __name__ == "__main__":
    # Ensure PyInstaller bundled files are handled properly
    if getattr(sys, 'frozen', False):
        # We are running in a bundle
        bundle_dir = sys._MEIPASS
        # Allow uvicorn to find the backend module
        sys.path.insert(0, bundle_dir)

    # Start browser opener thread
    threading.Thread(target=open_browser, daemon=True).start()

    # Run uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False)
