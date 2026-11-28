"""Exercise the Mac device boundary through the disposable Compose web proxy."""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = os.environ.get("WEB_URL", "http://127.0.0.1:3000").rstrip("/")
owner = base + "/api/v1/event-semi-auto"
path = owner + "/mac-executor/observation"
auth = {"Authorization": "Bearer " + os.environ["MAC_EXECUTOR_CI_TOKEN"]}

for url, method, headers, expected in (
    (path, "GET", {}, 401),
    (owner, "GET", auth, 401),
    (path, "POST", auth, 404),
):
    try:
        with urlopen(Request(url, method=method, headers=headers), timeout=10):
            raise AssertionError("Unexpected permission")
    except HTTPError as error:
        assert error.code == expected
        assert "no-store" in error.headers["Cache-Control"]

with urlopen(Request(path, headers=auth), timeout=10) as response:
    assert response.status == 200
    assert "no-store" in response.headers["Cache-Control"]
    observation = json.load(response)
assert set(observation) == {"status", "server_time", "intent"}
assert observation["status"] == "stopped" and observation["intent"] is None
print("Mac observation authentication, private cache policy and GET-only proxy verified.")
