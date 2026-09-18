# Auto Dispatch

A BB plugin that picks where a new thread runs. Switch on **Auto**, the wand button beside the send button in the new-thread composer, and [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's classifier model, chooses the project, machine, model, reasoning level, and environment as you type. It calls Jev with your own key, through the [Vercel AI Gateway](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway), [OpenRouter](https://openrouter.ai/typesafe/jev-1.13), or both.

- With Auto on, the composer's pickers follow the draft: Jev is asked again as you type, and the project, machine, environment, model, and reasoning pickers move to its answer. Nothing is hidden, so you see every choice, and you send the thread yourself.
- Send waits for Jev. From the first keystroke until the pickers match the text on screen, the send button is dimmed and Enter does nothing, so what runs is what you were shown. That is usually a fraction of a second after you stop typing.
- Change any picker by hand and it stays as you left it until Jev's answer for it changes. Permission mode is always yours.
- With Auto off, the composer behaves exactly as it always has. The toggle is remembered per browser.
- Attachments and @-mentions are untouched: the composer sends the draft itself.

## Install

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin auto-dispatch
```

## Set up

Open **Settings → Auto Dispatch**.

1. Paste a **Vercel AI Gateway API key** (Vercel dashboard → AI Gateway → API keys), an **OpenRouter API key** ([openrouter.ai/keys](https://openrouter.ai/keys)), or both. Keys are stored as secrets on the BB server and never sent to the browser. **Jev provider** picks which to use: `auto` uses whichever key is set, and with both set it asks the Vercel AI Gateway first and OpenRouter if that fails.
2. Under **Model rotation**, add the models Auto may pick. Each row is a provider and model, plus a note on when to use it, such as “UI design and planning”. You add models, not model-and-effort pairs: Jev picks the effort for each prompt from the levels that model supports. The effort shown on a row is ignored unless the model offers no choice.
3. Under **Projects**, leave **All projects** on, or turn it off and check the projects Auto may choose between. “No project” is one of them: it lets a prompt that fits no repository start a projectless thread.
4. Under **Environments**, check where threads may work. **Worktree** alone is the default, so every thread gets a fresh git worktree. Check more than one and Jev picks per prompt, for example a worktree for a code change and the project checkout for a question. A project none of them can serve, such as one that is not a git repository, falls back to Project checkout.
5. Under **Effort levels**, check the reasoning efforts Auto may pick. An unchecked level is never used, whatever a model supports. `ultra` and `ultracode` are special run modes that cost far more, so they start unchecked; check them if you want Auto to be able to use them.
6. Optionally write instructions. Each is plain English that Jev reads with the matching question:

| Setting | Read when choosing | Example |
| --- | --- | --- |
| General instructions | everything | “I'm a solo developer. My main repo is bb.” |
| Model instructions | the model and the reasoning level | “Use Fable for UI design and planning, Opus for most other tasks, Sonnet for simple tasks.” |
| Project instructions | the project | “Anything about the iOS app goes to the mobile project.” |
| Machine instructions | the machine | “iOS and macOS work must run on the MacBook. Prefer the Linux server otherwise.” |
| Environment instructions | the environment, when more than one is allowed | “Use a worktree for anything that changes code, the project checkout for questions.” |

**Permission mode** applies to threads started with `bb auto-dispatch spawn`, and is lowered where the machine or provider allows less. In the composer, the permission picker is yours.

Use **Try it** at the bottom of the page to route a prompt without starting anything.

## How a prompt is routed

Jev answers many questions about one piece of state in a single request, about as fast as it answers one. So Auto Dispatch follows TypeSafe's [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out) pattern: every question that might matter goes out together, including ones whose relevance depends on an answer not known yet, and code keeps the answers that turned out to apply. A decision is normally **one request, 200–350 ms**.

- **Project** and **model**. Each project is described by its name, repository, folders, and recent thread titles; each model by your note and the provider's description.
- **Reasoning level**, asked once per model in the rotation (“if this runs on Fable, how much effort?”), because the levels on offer and the sensible default depend on the model.
- **Machine**, asked once per distinct group of machines. Projects that live on the same machines share a question. Each machine's description says which of your allowed environments it can create, so a rule like “prefer a machine where Btrfs Cow is available” works.
- **Environment**, asked once per machine that can create more than one. Only some environments exist on some machines, so each question names its machine and offers only what that machine can create for the project.

Your general instructions ride in the shared state; each question carries the instructions for its own choice. With a very large number of machine groups, the rarest questions wait for a second request.

Jev is weak at arithmetic and exact comparison, so code does the parts that need facts. Only machines that hold the chosen project, offer an allowed environment, and can run the chosen provider are offered. Machine load is put into words (“CPU load is low (7% of 16 cores)”, “busy, 3 agent threads running now”) beside the numbers. A question with a single candidate is not asked at all. Jev is only ever offered the effort levels you checked under **Effort levels**.

Machine details come from a small host entry that runs on each enrolled machine and reports its operating system, CPU count and load, memory, and free disk. See exactly what Jev is told with `bb auto-dispatch machines`.

A thread started with `bb auto-dispatch spawn` keeps its decision, with probabilities, in its plugin metadata.

### Keeping it fast

The facts code needs — what each machine is doing, which providers it runs, which environments it can create for each project — are cached and refreshed behind the scenes, so a dispatch never waits on a slow machine. Jev is reached over one long-lived HTTP/2 connection per gateway rather than a new connection per call: the first request on a new connection takes a second or more, and Node drops idle connections after four seconds, so without this nearly every dispatch paid that price. When Auto is on, the composer asks the server to warm up as the screen opens: it opens that connection (priming a new one with a single trivial question) and refreshes the cached facts, so the first decision does not pay for them. While you type, at most one request is in the air and a new one starts no more than every 600 ms. `bb auto-dispatch route "<prompt>" --profile` prints a timeline of where the time went.

## CLI

```sh
bb auto-dispatch route "<prompt>" [--json] [--profile]   # where would this go? starts nothing
bb auto-dispatch spawn "<prompt>" [--json]               # route it and start the thread
bb auto-dispatch machines [--json]                       # what Jev is told about each machine
bb auto-dispatch rotation get [--json]                   # the model rotation
bb auto-dispatch rotation set '<json>'                   # replace it
bb auto-dispatch history [--days 14] [--json]            # the model and effort you chose per thread
bb auto-dispatch backtest [--days 14] [--map <regex>=<model>]... [--exclude <regex>] [--json]
                                                         # score the rules against those choices
```

## Tuning it to how you work

The plugin ships a `tune-auto-dispatch` skill. Ask an agent to “tune Auto Dispatch's model preferences” and it reads which model and effort you chose for the threads you started (`history`), works out what separates them, writes the rotation notes and the model instructions, and checks them by routing your past prompts through Jev (`backtest`), reporting agreement next to the always-pick-your-favourite baseline. `--map` counts threads on one model as another, for example a preview model you would now replace with your regular one; `--exclude` keeps matching prompts from being sent. Expect agreement to be capped by the composer's sticky pickers: the same kind of task often sits at several efforts in anyone's history.

## Privacy and cost

With Auto on, the draft is sent as you type, not only when you send it: every decision sends the prompt so far (the first 9,000 and last 3,000 characters of a long one), your instructions, project names, folders, remotes, and recent thread titles, and machine names and load to TypeSafe through the gateway you chose: the Vercel AI Gateway or OpenRouter. Jev costs $0.042 per million input tokens and a decision is a few thousand tokens, a small fraction of a cent; a prompt typed over ten seconds takes about fifteen of them. The Vercel AI Gateway's free tier allows only about 10 Jev calls per 5 minutes, which Auto uses up within one prompt; any Gateway credit lifts that. OpenRouter bills the same price from your OpenRouter credit.

## Limits

- Auto sets the pickers through the composer's own `experimental_setSelection`, so the values go in exactly as hand-picked ones do: the pickers remember them, and they count as your own choices in `bb auto-dispatch history`. The composer has the last word. It moves a reasoning level the model lacks to the nearest one it has, for instance, and its pickers show what it settled on.
- The plugin SDK has no way to hold a composer's send, so Auto does that against the composer's DOM: capture-phase listeners swallow Enter and the send button while a decision is pending, and a stylesheet dims the button. The selectors live in `lib/composer-dom.ts` and `app.css`. A BB release that renames them stops the hold, so a draft could be sent a moment before Auto has caught up with it; nothing worse.
- A failed round never holds the draft. If Jev cannot be reached, or takes more than eight seconds, the wand turns red, a toast says why once, and send works with the pickers as they are. Auto tries again when the draft changes.
- Auto works in any new-thread composer, including ones other plugins embed, but not in follow-ups to an existing thread.
- Choosing a project relies on names, folders, and recent thread titles. Similarly named projects need a line in **Project instructions**.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
bb plugin install . --yes
```

`lib/router.ts` holds the routing logic, `lib/live-fill.ts` schedules decisions as the draft changes, `lib/fill.ts` turns a decision into a composer selection, `lib/session.ts` keeps one Auto session per composer, `lib/jev.ts` the Jev client for both gateways, `lib/transport.ts` the warm connection, and `lib/history.ts` the backtest scoring; all but the transport are pure and covered by tests. `server.ts` gathers candidates from the BB SDK and spawns the thread, `host.ts` reports machine stats, and `app.tsx` owns the toggle and the settings sections.
