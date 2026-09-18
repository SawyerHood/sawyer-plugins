## Let Jev decide where a thread runs

Auto Dispatch adds an **Auto** toggle above the new-thread composer. Turn it on and the project, machine, and model pickers disappear. Type a prompt and press Enter, and [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's fast classifier model, picks the project, the machine, the model, the reasoning level, and the environment. The thread starts there about a second later.

## Or let it fill in the form

Would rather check its work? Leave Auto off and press **Auto-fill**, the wand button beside the send button. Jev makes the same choices and sets the composer's project, machine, environment, model, and reasoning pickers to them without sending. Change anything you disagree with, then send as usual.

## Tell it how you work

In **Settings → Auto Dispatch**, build the rotation of models Auto may pick, each with a note on when to use it. Choose which projects it may pick from, and which environments: a fresh git worktree per thread by default, or several for Jev to choose between. Choose which effort levels it may use; costly run modes like ultracode stay off unless you turn them on. Write plain-English instructions for choosing models, projects, and machines, such as “Use Fable for UI design and planning, Opus for most other tasks, Sonnet for simple tasks” or “iOS work must run on the MacBook.”

## Machines it understands

Each connected machine reports its operating system, CPU load, memory, free disk, and how many agent threads it is running. Jev sees that alongside your instructions, so an iOS task lands on a Mac and ordinary work goes to a machine that is idle.

## Tuned from your own history

Ask an agent to tune Auto Dispatch and the bundled skill reads which model and effort you picked for the threads you started, writes the rotation and instructions to match, and backtests them against those choices.

## Try it first

**Try it** in settings, or `bb auto-dispatch route "<prompt>"`, shows where a prompt would go and how sure Jev was, without starting anything.

## Requirements

Requires BB 0.43 or later, Plugin SDK 0.4.99 or later, and an API key for a gateway that serves Jev: the [Vercel AI Gateway](https://vercel.com/ai-gateway) or [OpenRouter](https://openrouter.ai/typesafe/jev-1.13). Each dispatch sends your prompt, your instructions, and the names, folders, and recent thread titles of your projects, plus machine names and load, to TypeSafe through that gateway. A dispatch costs a small fraction of a cent. Vercel's free tier allows only about 10 Jev calls per 5 minutes; any Gateway credit lifts that.
