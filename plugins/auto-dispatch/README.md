# Auto Dispatch

A BB plugin that picks where a new thread runs. Flip on **Auto** above the new-thread composer and [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's classifier model, chooses the project, machine, model, reasoning level, and environment for each prompt. It calls Jev with your own key, through the [Vercel AI Gateway](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway), [OpenRouter](https://openrouter.ai/typesafe/jev-1.13), or both.

- With Auto on, the project, environment, permission, and model pickers are hidden. Type a prompt and press Enter; the thread starts where Jev sent it, and a toast says where that was.
- With Auto off, the composer behaves exactly as it always has. The toggle is remembered per browser.
- Attachments and @-mentions in the draft travel with the prompt.

## Install

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin auto-dispatch
```

## Set up

Open **Settings → Auto Dispatch**.

1. Paste a **Vercel AI Gateway API key** (Vercel dashboard → AI Gateway → API keys), an **OpenRouter API key** ([openrouter.ai/keys](https://openrouter.ai/keys)), or both. Keys are stored as secrets on the BB server and never sent to the browser. **Jev provider** picks which to use: `auto` uses whichever key is set, and with both set it asks the Vercel AI Gateway first and OpenRouter if that fails.
2. Under **Model rotation**, add the models Auto may pick. Each row is a provider and model, plus a note on when to use it, such as “UI design and planning”. You add models, not model-and-effort pairs: Jev picks the effort for each prompt from the levels that model supports. The effort shown on a row is ignored unless the model offers no choice.
3. Under **Projects**, leave **All projects** on, or turn it off and check the projects Auto may choose between. “No project” is one of them: it lets a prompt that fits no repository start a projectless thread.
4. Under **Environments**, check where dispatched threads may work. **Worktree** alone is the default, so every thread gets a fresh git worktree. Check more than one and Jev picks per prompt, for example a worktree for a code change and the project checkout for a question. A project none of them can serve, such as one that is not a git repository, falls back to Project checkout.
5. Under **Effort levels**, check the reasoning efforts Auto may pick. An unchecked level is never used, whatever a model supports. `ultra` and `ultracode` are special run modes that cost far more, so they start unchecked; check them if you want Auto to be able to use them.
6. Optionally write instructions. Each is plain English that Jev reads with the matching question:

| Setting | Read when choosing | Example |
| --- | --- | --- |
| General instructions | everything | “I'm a solo developer. My main repo is bb.” |
| Model instructions | the model and the reasoning level | “Use Fable for UI design and planning, Opus for most other tasks, Sonnet for simple tasks.” |
| Project instructions | the project | “Anything about the iOS app goes to the mobile project.” |
| Machine instructions | the machine | “iOS and macOS work must run on the MacBook. Prefer the Linux server otherwise.” |
| Environment instructions | the environment, when more than one is allowed | “Use a worktree for anything that changes code, the project checkout for questions.” |

**Permission mode** applies to dispatched threads, and is lowered where the machine or provider allows less.

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

The decision, with probabilities, is saved in the thread's plugin metadata.

### Keeping it fast

The facts code needs — what each machine is doing, which providers it runs, which environments it can create for each project — are cached and refreshed behind the scenes, so a dispatch never waits on a slow machine. Jev is reached over one long-lived HTTP/2 connection per gateway rather than a new connection per call: the first request on a new connection takes a second or more, and Node drops idle connections after four seconds, so without this nearly every dispatch paid that price. While Auto is on and you are typing, the composer asks the server to warm up: it opens that connection (priming a new one with a single trivial question) and refreshes the cached facts, so pressing Enter costs one round trip. `bb auto-dispatch route "<prompt>" --profile` prints a timeline of where the time went.

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

Each dispatch sends the prompt (the first 9,000 and last 3,000 characters of a long one), your instructions, project names, folders, remotes, and recent thread titles, and machine names and load to TypeSafe through the gateway you chose: the Vercel AI Gateway or OpenRouter. Jev costs $0.042 per million input tokens and a dispatch is a few thousand tokens, a small fraction of a cent. The Vercel AI Gateway's free tier allows only about 10 Jev calls per 5 minutes, which is two dispatches; any Gateway credit lifts that. OpenRouter bills the same price from your OpenRouter credit.

## Limits

- The plugin SDK cannot hide the composer's pickers or take over its send, so Auto mode does both against the composer's DOM: a stylesheet hides the pickers, and capture-phase listeners route Enter and the send button to the plugin. The selectors live in `lib/composer-dom.ts` and `app.css`. A BB release that renames them would bring the pickers back or make Enter send normally; it cannot send a prompt twice.
- The SDK exposes the draft's text but not its attachments or mention pills, so those are read from the draft BB keeps in `localStorage`. If that ever stops matching the composer, Auto refuses to send a draft with attachments rather than dropping them.
- Auto works on the root New thread screen only, not in composers other plugins embed or in follow-ups to an existing thread.
- Choosing a project relies on names, folders, and recent thread titles. Similarly named projects need a line in **Project instructions**.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
bb plugin install . --yes
```

`lib/router.ts` holds the routing logic, `lib/jev.ts` the Jev client for both gateways, `lib/transport.ts` the warm connection, and `lib/history.ts` the backtest scoring; all but the transport are pure and covered by tests. `server.ts` gathers candidates from the BB SDK and spawns the thread, `host.ts` reports machine stats, and `app.tsx` owns the toggle and the settings sections.
