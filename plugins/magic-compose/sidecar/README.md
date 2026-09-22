# Laya sidecar

A local, free replacement for the Jev gateways. This is a small HTTP server
that loads the [laya](https://github.com/NandhaKishorM/laya) decision model
and serves it on `http://127.0.0.1:8787/decisions` in the same wire format
the OpenRouter decisions endpoint uses. Magic Compose talks to it with the
**Local (laya)** provider; no API key, no cloud, no cost.

## Run it

```sh
# one-time: a Python 3.10+ environment with the ML stack
uv venv && uv pip install torch transformers safetensors huggingface_hub numpy

# start the server (first run downloads the ~400M checkpoint from Hugging Face)
python laya_server.py            # serves http://127.0.0.1:8899/decisions
```

Or point at a local laya checkout:

```sh
python laya_server.py --model /path/to/laya
```

The server binds to loopback only. `GET /health` reports readiness; it is
safe to run it before BB starts or to restart it at any time. Magic Compose
retries the connection on the next draft.

## Performance

The model runs on Metal (Mac), CUDA, or CPU. On an M-series Mac a small
question answers in about 40 ms and a whole routing fan-out (about ten
questions) in one batched pass of roughly one to two seconds; the first
request after startup pays one-off warmup.

## Settings

- **Laya server URL**: where the sidecar listens. Default
  `http://127.0.0.1:8787`.
