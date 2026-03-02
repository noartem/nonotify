# nnt (nonotify)

Terminal-first notifier for Telegram.

Use it to send yourself a message when tasks are done, including from coding agents.

## Install

```bash
npm install -g nonotify
```

After install, `nnt` is available globally.

## Config location

- Default: `~/.nnt/config`
- Override: set `NNT_CONFIG_DIR`

Example:

```bash
export NNT_CONFIG_DIR="$HOME/.config/nnt"
```

Config is stored as JSON in `<config-dir>/config`.

## Add profile

```bash
nnt profile add
```

Optional explicit provider form:

```bash
nnt profile add telegram
```

Flow:

1. Enter profile name.
2. Enter Telegram bot token.
3. Send any message to your bot in Telegram.
4. CLI captures `chat_id`, shows connected Telegram `username`, stores the profile, and sends a confirmation message back to chat.

The first profile becomes default profile automatically.

## Manage profiles

List profiles:

```bash
nnt profile list
```

Show default profile:

```bash
nnt profile default
```

Set default profile:

```bash
nnt profile default important-profile
```

Edit profile (rename, token/chat update, reconnect):

```bash
nnt profile edit
nnt profile edit important-profile
nnt profile edit important-profile --newName=critical-profile
nnt profile edit critical-profile --botToken=123:abc
nnt profile edit critical-profile --reconnect
```

`nnt profile edit` starts interactive mode and asks you to select a profile first.

Delete profile:

```bash
nnt profile delete critical-profile
```

By default, profile commands print human-readable output in terminal. For strict machine-friendly output, use format flags:

```bash
nnt profile list --format json
nnt profile default --format=md
```

## Send messages

Send using default profile:

```bash
nnt "Default message"
```

Send using specific profile:

```bash
nnt "some message for user" --profile=important-profile
```

Equivalent explicit command:

```bash
nnt send "some message for user" --profile=important-profile
```

## Typical agent usage

```bash
nnt "Task finished: migrations applied and tests passed"
```

## Node.js API

`Notifier` loads config using `EnvConfigLoader` by default.

```ts
import { Notifier } from "nonotify";

const notifier = new Notifier();

await notifier.send({
  message: "Build finished successfully",
});
```

Also you can pass profile data directly.

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
