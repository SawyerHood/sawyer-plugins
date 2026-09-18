## Let Jev decide where a thread runs

Auto Dispatch adds **Auto**, a wand button beside the send button in the new-thread composer. Switch it on and start typing: [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's fast classifier model, picks the project, the machine, the model, the reasoning level, and the environment, and the composer's pickers move to its answer as you type.

## You see every choice before it runs

Nothing is hidden and nothing is sent for you. The send button waits, usually a fraction of a second, until the pickers match what you wrote, so what runs is what you were shown. Change any picker you disagree with and it stays put. Switch Auto off and the composer is exactly as it was.

## Tell it how you work

In **Settings → Auto Dispatch**, build the rotation of models Auto may pick, each with a note on when to use it. Choose which projects it may pick from, and which environments: a fresh git worktree per thread by default, or several for Jev to choose between. Choose which effort levels it may use; costly run modes like ultracode stay off unless you turn them on. Write plain-English instructions for choosing models, projects, and machines, such as “Use Fable for UI design and planning, Opus for most other tasks, Sonnet for simple tasks” or “iOS work must run on the MacBook.”

## Machines it understands

Each connected machine reports its operating system, CPU load, memory, free disk, and how many agent threads it is running. Jev sees that alongside your instructions, so an iOS task lands on a Mac and ordinary work goes to a machine that is idle.

## Tuned from your own history

Ask an agent to tune Auto Dispatch and the bundled skill reads which model and effort you picked for the threads you started, writes the rotation and instructions to match, and backtests them against those choices.

## Try it first

**Try it** in settings, or `bb auto-dispatch route "<prompt>"`, shows where a prompt would go and how sure Jev was, without starting anything.

## Requirements

Requires BB 0.43 or later, Plugin SDK 0.4.103 or later, and an API key for a gateway that serves Jev: the [Vercel AI Gateway](https://vercel.com/ai-gateway) or [OpenRouter](https://openrouter.ai/typesafe/jev-1.13). With Auto on, your prompt is sent as you type, not only when you send it. Each decision sends your prompt so far, your instructions, and the names, folders, and recent thread titles of your projects, plus machine names and load, to TypeSafe through that gateway. A decision costs a small fraction of a cent, and a prompt takes ten or so. Vercel's free tier allows only about 10 Jev calls per 5 minutes, which Auto uses up within one prompt; any Gateway credit lifts that.
