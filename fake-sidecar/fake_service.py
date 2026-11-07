"""A stand-in for schauling-service.exe: same protocol (SC-hauling's own server code), frozen /ui data.

    $env:SC_SERVICE_EXE = "python"
    $env:SC_SERVICE_ARGS = "fake-sidecar/fake_service.py"
    cargo run   (from src-tauri)

Takes the same options as the real service; the token comes from SC_OVERLAY_TOKEN.
"""
import argparse
import copy
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
HAULING = Path(os.environ.get("SC_HAULING", HERE.parent.parent / "SC-hauling"))
sys.path.insert(0, str(HAULING))

from schauling import liveserver, service  # noqa: E402


def iso(offset_s):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + offset_s))


def decorate(ui):
    """Demo data in the documented /ui shapes, with times relative to now so the countdown moves."""
    ui = copy.deepcopy(ui)
    ui["route"] = [
        {"place": "Lorville", "arrival": iso(0), "jump": None, "local": {"clock": "14:20", "phase": "Afternoon", "day": True},
         "actions": [{"type": "load", "scu": 11, "cargo": "Agricium"}]},
        {"place": "Area18", "arrival": iso(900), "jump": "Hurston → ArcCorp",
         "local": {"clock": "03:10", "phase": "Night", "day": False},
         "actions": [{"type": "unload", "scu": 11, "cargo": "Agricium"}]},
    ]
    ui["heading"] = {"from": "Lorville", "to": "Area18", "pickedAt": iso(-30), "eta": iso(900), "jumpAt": iso(40)}
    ui["trade"] = {"on": True, "budget": 50000, "error": None, "fetching": False, "suggestions": [
        {"buyAt": 0, "sellAt": 1, "buyPlace": "Lorville", "sellPlace": "Area18", "name": "Agricium", "scu": 32,
         "buy": 25, "sell": 30, "profit": 45000, "old": False, "done": {"buy": False, "sell": False}},
        {"buyAt": 1, "sellAt": 0, "buyPlace": "Area18", "sellPlace": "Lorville", "name": "Medical Supplies", "scu": 16,
         "buy": 18, "sell": 20, "profit": 2400, "old": True, "done": {"buy": False, "sell": False}}]}
    ui["location"] = {"name": "Lorville", "source": "log"}
    ui["team"] = {"code": "abcdefgh23", "name": "Alexis", "self": "m1", "error": None, "reading": False,
                  "readError": None, "members": [
        {"id": "m1", "name": "Alexis", "updatedAt": iso(-5), "state": {"shard": "pub_euw1b_12881860_150"}, "crossings": [], "shared": []},
        {"id": "m2", "name": "Helmarok", "updatedAt": iso(-20), "state": {"shard": "pub_euw1b_12881860_150"}, "crossings": [], "shared": ["m1"]},
        {"id": "m3", "name": "Kestrel", "updatedAt": iso(-30), "state": {"shard": "pub_use1b_999_7"}, "crossings": [], "shared": []},
        {"id": "m4", "name": "Old-client", "updatedAt": iso(-40), "state": {}, "crossings": [], "shared": []}]}
    ui["shard"] = "pub_euw1b_12881860_150"
    ui["warnings"] = ["Fake warning: patch 4.x not tested"]
    ui["routeLines"] = ["1. Lorville", "     ↑ load 11 SCU Agricium", "2. Area18  (+15m00s, jump Hurston → ArcCorp)",
                        "     ↓ unload 11 SCU Agricium", "Max aboard: 11 / 46 SCU"]
    return ui


class FakeApi:
    def __init__(self, token, ui):
        self.token = token
        self.hub = service.Hub()
        self.ui = ui
        self.hub.publish(ui)

    def snapshot(self):
        return self.hub.snapshot()

    def snapshot_event(self):
        return self.hub.snapshot_event()

    def subscribe(self):
        return self.hub.subscribe()

    def unsubscribe(self, q):
        self.hub.unsubscribe(q)

    def act(self, request):
        kind = request.get("type")
        if kind == "set_start" and isinstance(request.get("place"), str):
            ui = copy.deepcopy(self.ui)
            ui["start"] = {"place": request["place"] or None, "source": "manual"}
            self.ui = ui
            self.hub.publish(ui)
            return 200, {"ok": True}
        if kind == "trade_done" and request.get("side") in ("buy", "sell"):
            ui = copy.deepcopy(self.ui)
            for t in ui["trade"]["suggestions"]:
                if (t["buyPlace"], t["sellPlace"], t["name"]) == (request.get("buyPlace"), request.get("sellPlace"), request.get("name")):
                    t["done"][request["side"]] = request.get("done", True) is not False
            self.ui = ui
            self.hub.publish(ui)
            return 200, {"ok": True}
        if kind in service.ACTIONS:
            return 200, {"ok": True}  # accepted, nothing changes
        return 400, {"ok": False, "error": "unknown action"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--service", action="store_true")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--parent-pid", type=int, default=0)
    args = ap.parse_args()
    token = os.environ.get("SC_OVERLAY_TOKEN", "")
    if not token:
        sys.exit("no token (SC_OVERLAY_TOKEN)")
    ui = decorate(json.loads((HERE / "ui.json").read_text(encoding="utf-8")))
    api = FakeApi(token, ui)
    server = liveserver.LiveServer(lambda: {"version": 1, "fake": True}, api=api)
    server.start(args.port)
    if not server.running:
        sys.exit(3)
    if args.parent_pid:
        service.watch_parent(args.parent_pid, lambda: os._exit(0))
    while True:
        time.sleep(1)


if __name__ == "__main__":
    main()
