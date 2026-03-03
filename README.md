# nnt

А terminal-first notifier built with [incur](https://github.com/wevm/incur). Use it to send yourself messages from the terminal, including from coding agents and CI jobs.

## Install

```bash
npm install -g nonotify
```

After installation, `nnt` is available globally.

## Add profile

```bash
nnt profile add
```

Flow:

1. Enter profile name.
2. Enter Telegram bot token.
3. Send any message to your bot in Telegram.
4. CLI captures `chatId`, shows connected Telegram `username`, stores the profile, and sends a confirmation message back to chat.

The first profile becomes default profile automatically.

## Send messages

Send with the default profile:

```bash
nnt "Cool message using nnt"
```

Send with a specific profile:

```bash
nnt "some urgent message" --profile=important
```

Typical agent usage:

```bash
# User: Complete a long task, while I'm away, when finish notify me via nnt
# Agent: *working*
# Agent after task completed:
nnt "Very long task finished. All tests passed, check out result"
```

## Install skills

You can install agent skills for your agents:

```bash
nnt skills add                                # install skills globally
cp ~/.agents/skills/nnt-* ./.agents/skills/   # install in current project
```

## Manage profiles

List profiles:

```bash
nnt profile list
```

Show the default profile:

```bash
nnt profile default
```

Set the default profile:

```bash
nnt profile default important-profile
```

Edit a profile (rename, token/chat update, reconnect):

```bash
nnt profile edit
nnt profile edit important-profile
nnt profile edit important-profile --newName=critical-profile
nnt profile edit critical-profile --botToken=123:abc
nnt profile edit critical-profile --reconnect
```

`nnt profile edit` starts interactive mode and prompts you to select a profile first.

Delete profile:

```bash
nnt profile delete critical-profile
```

By default, profile commands print human-readable output in terminal. For strict, machine-friendly output, use format flags:

```bash
nnt profile list --format json
nnt profile default --format=md
```

## OpenCode plugin

There is also the [nonotify-opencode](https://www.npmjs.com/package/nonotify-opencode) plugin that automatically sends you important notifications via `nnt` when you use [OpenCode](https://github.com/anomalyco/opencode). Learn more [here](https://github.com/noartem/nnt/tree/main/nonotify-opencode).

## Config location

Config is stored as JSON at `<config-dir>/nnt.json`.

- Default config dir: `~/.config/nnt`
- Default config path: `~/.config/nnt/nnt.json`
- To override it, set `NNT_CONFIG_DIR`

Example:

```bash
export NNT_CONFIG_DIR="$HOME/.custom-config/custom-nnt"
```

If you run coding agents in a container, mount the config directory as read-only:

```yaml
services:
  app:
    environment:
      - NNT_CONFIG_DIR=/var/nnt
    volumes:
      - ${HOME}/.config/nnt:/var/nnt:ro
```

## API

You can integrate `nnt` into your application. Useful when buildling extensions for coding agents. The `Notifier` automaticly loads profile information, so you can send messages easily.

```ts
import { Notifier } from "nonotify";

const notifier = new Notifier();

await notifier.send({
  message: "Build finished successfully",
});
```

Notifier loads config using `EnvConfigLoader` by default, but you can also pass profile data directly.

```ts
import { Notifier } from "nonotify";

const notifier = new Notifier({
  defaultProfile: "dev",
  profiles: [
    {
      name: "dev",
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
    },
  ],
});

await notifier.send({
  profile: "dev",
  message: "Task completed",
});

console.log(notifier.profiles);
```

## Monorepo release flow

This repository is an npm workspaces monorepo with automated releases via Changesets.

- Every user-facing package change should include a changeset:

```bash
npx changeset
```

- Release automation behavior:
  - on `main`, GitHub Actions creates/updates a release PR with version bumps and changelogs;
  - after merging that PR, Actions publishes changed packages to npm;
  - Git tags and GitHub Releases are created automatically.
