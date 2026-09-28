"""Persistent local Laya worker. Stdout is a JSON-lines protocol, never a mock."""
import json
import os
import sys
import time
import traceback

protocol = sys.stdout
sys.stdout = sys.stderr
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def send(payload):
    protocol.write(json.dumps(payload, ensure_ascii=False) + "\n")
    protocol.flush()


try:
    send({"event": "status", "status": "loading", "detail": "Loading local Laya checkpoint"})
    import torch
    from laya import Router
    import laya
    torch.set_num_threads(int(os.environ.get("LAYA_THREADS", "4")))
    router = Router(device=os.environ.get("LAYA_DEVICE", "cpu"), max_loaded=2)
    # Real warmup validates both checkpoint availability and inference, not just import.
    router.predict("Hello", {"ready": {"type": "choice", "instructions": "Classify the message.",
                                     "criteria": {"greeting": "a greeting", "other": "other text"}}})
    send({"event": "status", "status": "ready", "version": laya.__version__,
          "device": os.environ.get("LAYA_DEVICE", "cpu"), "detail": "Local Router ready"})
except Exception as exc:
    traceback.print_exc()
    send({"event": "status", "status": "error", "detail": str(exc)})
    sys.exit(1)

for line in sys.stdin:
    try:
        request = json.loads(line)
        started = time.perf_counter()
        if request["op"] == "batch":
            result = router.predict_batch(request["requests"], batch_size=4, sort_by_length=True)
        else:
            result = router.predict(request["state"], request["questions"],
                                    model=request.get("model"),
                                    max_len=request.get("max_len", 1024),
                                    head_max_len=request.get("head_max_len", 384))
        send({"id": request["id"], "result": result,
              "inference_ms": round((time.perf_counter() - started) * 1000)})
    except Exception as exc:
        traceback.print_exc()
        send({"id": request.get("id"), "error": str(exc)})
