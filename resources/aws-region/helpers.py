# The emulator and the plumbing to call it. Python owns no socket under Pyodide, so the
# ASGI app is driven directly: every "request" is an in-process function call. All Python
# file IO stays in MEMFS - writes through a Vivari node mount return corrupt lengths - and
# the bridge copies bytes between MEMFS and the persistent data dir.
import asyncio
import json
import os
import tempfile
from collections import namedtuple
from urllib.parse import quote

os.makedirs("/tmp", exist_ok=True)
tempfile.tempdir = "/tmp"

# STATE_ROOT is injected by the bridge before this file runs. Object bodies persist through
# a switch of their own: with only PERSIST_STATE the buckets come back empty
STATE_DIR = f"{STATE_ROOT}/state"
S3_DATA_DIR = f"{STATE_ROOT}/objects"
os.makedirs(STATE_DIR, exist_ok=True)
os.makedirs(S3_DATA_DIR, exist_ok=True)
os.environ.update(
    PERSIST_STATE="1",
    STATE_DIR=STATE_DIR,
    S3_PERSIST="1",
    S3_DATA_DIR=S3_DATA_DIR,
    # The queue URLs the emulator mints are dialled directly by the AWS SDK, so they have
    # to name the port the bridge actually listens on
    GATEWAY_PORT=str(REGION_PORT),
)

# Each service reads its own state file as it imports, so this line is the restore
from ministack.app import app, _build_persistence_save_dict
from ministack.core.persistence import save_all


# _build_persistence_save_dict is private to ministack, but it is the same call its own
# lifespan shutdown makes; a patch release could move it
def save_state():
    save_all(_build_persistence_save_dict())


# The app expects one long-lived lifespan call, as a real ASGI server gives it: startup is
# delivered once and it then blocks on the queue until shutdown. Answering every receive()
# with startup instead puts it in an infinite loop
_lifespan_queue = asyncio.Queue()
_lifespan_reached = {}
_lifespan_task = None


async def _lifespan_receive():
    return await _lifespan_queue.get()


async def _lifespan_send(message):
    # "lifespan.startup.complete" -> "startup"
    _lifespan_reached.setdefault(message["type"].split(".")[1], asyncio.Event()).set()


async def lifespan(phase):
    global _lifespan_task
    if _lifespan_task is None:
        _lifespan_task = asyncio.ensure_future(
            app({"type": "lifespan", "asgi": {"version": "3.0"}}, _lifespan_receive, _lifespan_send)
        )
    reached = _lifespan_reached.setdefault(phase, asyncio.Event())
    await _lifespan_queue.put({"type": f"lifespan.{phase}"})
    await asyncio.wait_for(reached.wait(), timeout=120)


Response = namedtuple("Response", ("status", "headers", "body"))


async def asgi_request(method, target, headers, body=b""):
    path, _, query = target.partition("?")
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "query_string": query.encode(),
        "headers": [(str(k).lower().encode(), str(v).encode()) for k, v in headers],
        "client": ("127.0.0.1", 1),
        "server": ("127.0.0.1", 443),
        "scheme": "http",
    }
    sent = []

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    start = next(m for m in sent if m["type"] == "http.response.start")
    payload = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return Response(start["status"], start.get("headers", []), payload)


def auth_header(service):
    return (
        "AWS4-HMAC-SHA256 Credential=GGINTERNAL/20260101/us-east-1/"
        f"{service}/aws4_request, SignedHeaders=host, Signature=internal"
    )


def _internal_headers(service, extra=None):
    merged = {"host": "localhost", "authorization": auth_header(service)}
    merged.update(extra or {})
    return list(merged.items())


# The JSON protocol SQS and DynamoDB speak; the app routes on the credential scope
async def json_api(service, target, body):
    response = await asgi_request(
        "POST",
        "/",
        _internal_headers(
            service, {"x-amz-target": target, "content-type": "application/x-amz-json-1.0"}
        ),
        json.dumps(body).encode(),
    )
    return response.status, (json.loads(response.body) if response.body else {})


async def s3_request(method, path, data=b"", extra_headers=None):
    return await asgi_request(
        method.upper(), path, _internal_headers("s3", extra_headers), data
    )


def object_path(bucket, key):
    return f"/{bucket}/{quote(key, safe='/')}"
