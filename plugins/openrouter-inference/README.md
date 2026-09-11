# OpenRouter Inference

A BB plugin that generates thread titles and commit messages with any [OpenRouter](https://openrouter.ai) model, using your own API key.

- Enter an OpenRouter API key. BB stores it as a secret setting on the server.
- Search the full OpenRouter model list by name or id, with prices and context sizes.
- Switch BB's helper inference (`BB_INFERENCE`) to this plugin with one button.
- Test the key and model with a sample title before switching.

## Install

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin openrouter-inference
```

## Set up

1. Open **Settings → OpenRouter Inference**.
2. Paste a key from [openrouter.ai/keys](https://openrouter.ai/keys) into **OpenRouter API key**.
3. Search the model list and click a model. Fast, cheap models work best, because BB gives title and commit-message requests about five seconds.
4. Click **Test** to generate a sample title.
5. Click **Use for titles & commit messages**.

The button sets `BB_INFERENCE` to `openrouter-inference/default` in BB's managed `config.json` and reloads the server config. The `default` segment tells the plugin to use the model picked in settings, so changing models later takes effect without editing config again. `BB_INFERENCE_FALLBACK` stays as it was.

To switch back, set `BB_INFERENCE` to another service (for example `bb-app config set BB_INFERENCE codex/gpt-5.6-luna`), or remove the `BB_INFERENCE` entry from `~/.bb/config.json` and run `bb settings reload`.

From a terminal:

```sh
bb plugin config openrouter-inference set apiKey sk-or-...
bb plugin config openrouter-inference set model anthropic/claude-haiku-4.5
bb settings ai-services
```

## How it works

The plugin registers the `openrouter-inference` AI service. BB serves helper inference from the primary host, so the server copies the key and model to that host's plugin data directory with mode 0600 whenever settings change. The host calls OpenRouter's chat completions API with a strict JSON schema response format. It turns reasoning off where the model allows it, or uses the cheapest effort a model supports.

Failures use BB's AI-service codes. A bad key is `auth_required`. Rate limits and exhausted credits are `rate_limited`. Outages are `service_unavailable`, and slow replies are `timeout`. BB retries `rate_limited`, `service_unavailable`, and `timeout` with `BB_INFERENCE_FALLBACK`.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
bb plugin install . --yes
```

Requires BB >=0.42 and Plugin SDK >=0.4.56.

## License

MIT
