# nonotify-opencode

[OpenCode](https://github.com/anomalyco/opencode) plugin that sends notifications and interactive Telegram questions through [nnt](https://github.com/noartem/nnt) when:

- a permission request is pending for more than 1 minute
- a question request (agent needs your input) is pending for more than 1 minute

After the delay, the plugin tries to answer directly from Telegram:

- permission requests get buttons for `allow once`, `allow always`, and `deny`
- single-choice OpenCode questions are answered with one Telegram button tap
- multi-select OpenCode questions are asked step by step until you press `Завершить выбор`

If the same request is already answered in the OpenCode UI, the later Telegram answer is ignored.

## Installation (from npm)

1. Configure `nnt` at least once (if you have not done it yet):

```bash
npm i -g nonotify
nnt profile add
```

2. Add the plugin package to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["nonotify-opencode"]
}
```

3. Restart OpenCode.

OpenCode installs npm plugins and their dependencies automatically at startup.

## Optional configuration

- Use plugin config in `opencode.json` to pick a profile:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["nonotify-opencode"],
  "nonotify-opencode": {
    "profile": "important",
    "approvalDelaySeconds": 60,
    "questionDelaySeconds": 60
  }
}
```

- `profile` defaults to your `nnt` default profile.
- `NNT_PROFILE`: fallback source when `profile` is not set in config.
- Timing values are in seconds.
- `approvalDelaySeconds`: wait before notifying about pending permission request (default `60`).
- `questionDelaySeconds`: wait before notifying about pending question request (default `60`).

## Notes

- The plugin uses `Notifier.ask()` from `nonotify`, so install a version that includes `nnt ask` support.
- If interactive asking is unavailable or fails, the plugin falls back to a regular notification message.
