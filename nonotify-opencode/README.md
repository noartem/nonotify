# nonotify-opencode

[OpenCode](https://github.com/anomalyco/opencode) plugin that sends notifications through [nnt](https://github.com/noartem/nnt) when:

- a permission request is pending for more than 1 minute
- a question request (agent needs your input) is pending for more than 1 minute
- an assistant reply completes after running for more than 5 minutes and there is no user activity in that session for 1 minute

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
    "questionDelaySeconds": 60,
    "longReplyThresholdSeconds": 300,
    "activityDelaySeconds": 60
  }
}
```

- `profile` defaults to your `nnt` default profile.
- `NNT_PROFILE`: fallback source when `profile` is not set in config.
- Timing values are in seconds.
- `approvalDelaySeconds`: wait before notifying about pending permission request (default `60`).
- `questionDelaySeconds`: wait before notifying about pending question request (default `60`).
- `longReplyThresholdSeconds`: minimum assistant reply duration to be considered long (default `300`).
- `activityDelaySeconds`: extra wait before long-reply notification; cancelled if user becomes active (default `60`).

Example:

```bash
export NNT_PROFILE=important
```

If sending fails (for example, no profile is configured), the plugin logs a warning and disables further alert attempts in the current process.
