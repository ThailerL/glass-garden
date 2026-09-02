# The function surface the JS bridge calls. Runs last: everything defined by the other
# python files is already in this namespace.
import glob
import html
import re
import time

from pyodide.ffi import to_js


# One data-plane request: the caller's method/path/headers/body, forwarded verbatim. body
# arrives as a JS Uint8Array; the return converts to a JS array of
# [status, headers JSON, body Uint8Array] via to_js
async def gg_dispatch(method, target, headers_json, body):
    data = body.to_bytes() if body is not None else b""
    headers = list(json.loads(headers_json).items())
    response = await asgi_request(method, target, headers, data)

    def text(value):
        return value.decode() if isinstance(value, bytes) else value

    kept = [
        [text(k), text(v)] for k, v in response.headers if text(k).lower() != "content-length"
    ]
    return to_js([response.status, json.dumps(kept), response.body])


# stateFiles is what was on disk to load, not proof each one loaded: the emulator refuses a
# file whose format version it does not recognise and starts that service empty, saying so
async def gg_start():
    await lifespan("startup")
    state_files = sorted(
        os.path.basename(path)[: -len(".json")] for path in glob.glob(f"{STATE_DIR}/*.json")
    )
    return json.dumps({"stateFiles": state_files, "deferred": DEFERRED, "failed": FAILED})


# What each resource is holding, for the metrics its node shows. Read off the backends rather
# than through the data plane, so sampling never counts as traffic the user caused. The
# module-level stores are private to ministack, like the persistence call above: a release
# could move them
async def gg_stats():
    from ministack.services.s3 import _buckets
    from ministack.services.sqs import _queues
    from ministack.services.dynamodb import _tables

    buckets = {}
    for name, bucket in _buckets.items():
        objects = bucket.get("objects") or {}
        total = sum(entry.get("size", 0) for entry in objects.values())
        buckets[name] = {"objects": len(objects), "size (MB)": total / 1e6}

    # A message is in flight once it has been received and its visibility timeout has not
    # yet lapsed; until then it is waiting to be picked up
    now = time.time()
    queues = {}
    for queue in _queues.values():
        messages = queue.get("messages") or []
        in_flight = sum(
            1 for m in messages if m.get("receipt_handle") and m.get("visible_at", 0) > now
        )
        queues[queue["name"]] = {
            "messages": len(messages) - in_flight,
            "in flight": in_flight,
        }

    # items is keyed by partition value, then by sort value, so the item count is the sum of
    # the inner maps rather than the size of the outer one
    tables = {}
    for name, table in _tables.items():
        items = table.get("items") or {}
        tables[name] = {"items": sum(len(rows) for rows in items.values())}

    return json.dumps({"s3": buckets, "sqs": queues, "dynamodb": tables})


# Lifespan shutdown persists on its way out; the bridge copies the files afterwards
async def gg_stop():
    await lifespan("shutdown")


# config carries the service-specific create-time settings a node's definition sends
# (queue attributes, table key schema); everything else gets a teachable default
async def gg_provision(service, name, config_json):
    config = json.loads(config_json or "{}")
    if service == "s3":
        created = await s3_request("put", f"/{name}")
        # 409 is BucketAlreadyOwnedByYou territory: provisioning is idempotent
        if created.status not in (200, 409):
            raise RuntimeError(f"CreateBucket answered {created.status}")
        return json.dumps({"bucket": name})
    if service == "sqs":
        # Created bare and then configured, rather than created with its attributes: a
        # CreateQueue naming attributes that differ from an existing queue is an error, and
        # provisioning runs again every time the node starts with edited settings
        status, created = await json_api("sqs", "AmazonSQS.CreateQueue", {"QueueName": name})
        if status != 200:
            raise RuntimeError(f"CreateQueue failed: {created}")
        url = created.get("QueueUrl")
        attributes = config.get("attributes") or {}
        if attributes:
            status, updated = await json_api(
                "sqs",
                "AmazonSQS.SetQueueAttributes",
                {"QueueUrl": url, "Attributes": {k: str(v) for k, v in attributes.items()}},
            )
            if status != 200:
                raise RuntimeError(f"SetQueueAttributes failed: {updated}")
        return json.dumps({"queueUrl": url})
    if service == "dynamodb":
        status, created = await json_api(
            "dynamodb",
            "DynamoDB_20120810.CreateTable",
            {
                "TableName": name,
                "KeySchema": config.get("keySchema")
                or [{"AttributeName": "pk", "KeyType": "HASH"}],
                "AttributeDefinitions": config.get("attributeDefinitions")
                or [{"AttributeName": "pk", "AttributeType": "S"}],
                "BillingMode": "PAY_PER_REQUEST",
            },
        )
        if status == 200 or created.get("__type", "").endswith("ResourceInUseException"):
            return json.dumps({"table": name})
        raise RuntimeError(f"CreateTable failed: {created}")
    raise RuntimeError(f"unknown service {service}")


async def gg_deprovision(service, name):
    if service == "s3":
        while True:
            keys = await _bucket_key_page(name)
            if keys is None:
                return
            if not keys:
                break
            for key in keys:
                await s3_request("delete", object_path(name, key))
        await s3_request("delete", f"/{name}")
        return
    if service == "sqs":
        status, found = await json_api("sqs", "AmazonSQS.GetQueueUrl", {"QueueName": name})
        if status == 200:
            await json_api("sqs", "AmazonSQS.DeleteQueue", {"QueueUrl": found["QueueUrl"]})
        return
    if service == "dynamodb":
        await json_api("dynamodb", "DynamoDB_20120810.DeleteTable", {"TableName": name})
        return
    raise RuntimeError(f"unknown service {service}")


# One page of object keys, for the drain loop. None when the bucket does not exist
async def _bucket_key_page(bucket):
    listing = await s3_request("get", f"/{bucket}?list-type=2")
    if listing.status == 404:
        return None
    return [html.unescape(k) for k in re.findall(r"<Key>([^<]*)</Key>", listing.body.decode())]
