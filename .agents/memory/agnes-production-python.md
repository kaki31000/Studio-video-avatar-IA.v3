---
name: Agnes production Python runtime
description: Environment constraint for starting the Agnes engine in published artifact deployments.
---

The published artifact runtime exposes the Replit-managed `.pythonlibs` environment, but the `.venv` that `uv sync` may create during the build is not reliably present when the service starts. Agnes production commands should use the workspace-relative `.pythonlibs/bin/python` environment.

**Why:** A publication build completed successfully, but the service crashed at startup because `../../../.venv/bin/python` did not exist in the runtime image. The same engine started successfully with `.pythonlibs/bin/python`.

**How to apply:** When changing the Agnes production run command, preserve the workspace-root path to `artifacts/studio-avatar/agnes-engine` and use `../../../.pythonlibs/bin/python`.