"""Write fake-sidecar/ui.json from the real SC-hauling build_ui (so the frozen file cannot drift from the schema).

    python fake-sidecar/freeze_ui.py [path to SC-hauling]
"""
import json
import os
import sys
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
HAULING = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SC_HAULING", HERE.parent.parent / "SC-hauling"))
sys.path.insert(0, str(HAULING))

from schauling import controller as controller_module  # noqa: E402
from schauling import service  # noqa: E402
from schauling.controller import Controller  # noqa: E402
from tests.test_service import fake_world  # noqa: E402


def main():
    session, _contract, _calls = fake_world()
    with mock.patch.object(controller_module.config, "save"):
        controller = Controller(session, {"ship": "Cutlass"})
    ui = service.build_ui(controller, now=1_700_000_000)
    ui["status"] = "Fake service: frozen data"
    ui["routeLines"] = ["Lorville: pick up 11 SCU Agricium", "Area18: drop 11 SCU"]
    out = HERE / "ui.json"
    out.write_text(json.dumps(ui, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out} (version {ui['version']})")


if __name__ == "__main__":
    main()
