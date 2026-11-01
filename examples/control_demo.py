"""Python standard-library client. Open the model page before running this file."""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description="Control the local Live2D demo")
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--method", help="Send one method instead of the ten-second demo")
    parser.add_argument("--params", default="{}", help="Method parameters as JSON")
    args = parser.parse_args()
    # Bypass inherited corporate/system proxies for the local demo.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def command(method, params=None):
        request = urllib.request.Request(
            args.url.rstrip("/") + "/api/command",
            data=json.dumps({"method": method, "params": params or {}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            with opener.open(request, timeout=25) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = json.load(error)
            raise RuntimeError(detail.get("message", detail.get("error"))) from error

    if args.method:
        print(json.dumps(command(args.method, json.loads(args.params)), ensure_ascii=False, indent=2))
        return
    command("engine.reset")
    result = command("demo.play")
    print("Demo started:", result["request_id"])
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        state = command("state.get")["result"]
        print(f"frame={state['frame']:4d}  time={state['time_ms']/1000:5.2f}s  gesture={state['gesture']}")
        if not state["timeline"]:
            print("Demo completed.")
            return
        time.sleep(1)
    raise TimeoutError("Demo did not finish; keep the browser model page open and active")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
