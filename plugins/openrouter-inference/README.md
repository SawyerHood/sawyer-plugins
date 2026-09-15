# OpenRouter Inference

A BB plugin that generates thread titles and commit messages, and transcribes voice input, with [OpenRouter](https://openrouter.ai) models, using your own API key.

- Enter an OpenRouter API key. BB stores it as a secret setting on the server.
- Search the full OpenRouter model list by name or id, with prices and context sizes.
- Search OpenRouter's speech-to-text models, such as Whisper, GPT-4o Transcribe, and Deepgram Nova.
- Switch BB's helper inference (`BB_INFERENCE`) and voice transcription (`BB_TRANSCRIPTION`) to this plugin with one button each.
- Test the key and each model before switching, with a sample title or a transcript of a short built-in clip.

## Install

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin openrouter-inference
```

## Set up

1. Open **Settings → OpenRouter Inference**.
2. Paste a key from [openrouter.ai/keys](https://openrouter.ai/keys) into **OpenRouter API key**.

### Titles and commit messages

1. Under **Titles & commit messages**, search the model list and click a model. Fast, cheap models work best, because BB gives title and commit-message requests about five seconds.
2. Click **Test** to generate a sample title.
3. Click **Use for titles & commit messages**.

The button sets `BB_INFERENCE` to `openrouter-inference/default` in BB's managed `config.json` and reloads the server config. The `default` segment tells the plugin to use the model picked in settings, so changing models later takes effect without editing config again. `BB_INFERENCE_FALLBACK` stays as it was.

To switch back, set `BB_INFERENCE` to another service (for example `bb-app config set BB_INFERENCE codex/gpt-5.6-luna`), or remove the `BB_INFERENCE` entry from `~/.bb/config.json` and run `bb settings reload`.

### Voice transcription

1. Under **Voice transcription**, search the speech-to-text models and click one. The default is `openai/gpt-4o-mini-transcribe`. BB gives each transcription attempt 10 seconds.
2. Click **Test** to transcribe a 2.6-second sample clip.
3. Click **Use for voice transcription**.

The button sets `BB_TRANSCRIPTION` to `openrouter-inference/default` the same way. To switch back, run `bb-app config set BB_TRANSCRIPTION codex/gpt-transcribe`.

From a terminal:

```sh
bb plugin config openrouter-inference set apiKey sk-or-...
bb plugin config openrouter-inference set model anthropic/claude-haiku-4.5
bb plugin config openrouter-inference set transcriptionModel openai/whisper-large-v3-turbo
bb settings ai-services
bb voice transcribe memo.m4a
```

## How it works

The plugin registers the `openrouter-inference` AI service for both inference and voice. BB serves both from the primary host, so the server copies the key and models to that host's plugin data directory with mode 0600 whenever settings change.

For titles and commit messages, the host calls OpenRouter's chat completions API with a strict JSON schema response format. It turns reasoning off where the model allows it, or uses the cheapest effort a model supports.

For voice input, the host sends the recording to OpenRouter's `/audio/transcriptions` API as base64, with its format (webm, ogg, m4a, mp3, wav, flac, or aac) taken from the file extension or MIME type. BB also passes the composer text before the cursor as context. OpenRouter's API has no generic prompt field, so the plugin sends the last 1,000 characters only to OpenAI and Groq, whose transcription APIs accept a prompt. Other providers transcribe without it. BB limits plugin-served recordings to 5 MB.

Failures use BB's AI-service codes. A bad key is `auth_required`. Rate limits and exhausted credits are `rate_limited`. Outages are `service_unavailable`, and slow replies are `timeout`. BB retries `rate_limited`, `service_unavailable`, and `timeout` with `BB_INFERENCE_FALLBACK` for titles and commit messages, and once with the same model for voice transcription.

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
