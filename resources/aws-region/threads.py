# Pyodide has no pthreads, so ministack's background workers cannot start. Run each one
# inline instead: fire-and-forget workers (S3 event fanout, SNS delivery) complete during
# the request that triggered them, and loop-forever workers hit the first sleep and are
# deferred. Must run before ministack is imported.
import threading
import time


# What the shim did with each worker it saw, for the boot report
DEFERRED = []
FAILED = []


class _Deferred(BaseException):
    """Not an Exception: workers wrap their bodies in `except Exception`."""


def _no_sleep(seconds):
    raise _Deferred(f"would sleep {seconds}s")


def _inline_start(self):
    real_sleep = time.sleep
    time.sleep = _no_sleep
    try:
        self.run()
    except _Deferred as deferred:
        DEFERRED.append(f"{self.name} ({deferred})")
    except Exception as error:
        FAILED.append(f"{self.name}: {error!r}")
    finally:
        time.sleep = real_sleep


# The worker already ran inside start(), but the stdlib refuses to join a thread it never
# saw start, and lifespan startup joins the container reaper
threading.Thread.start = _inline_start
threading.Thread.join = lambda self, timeout=None: None
threading.Thread.is_alive = lambda self: False
