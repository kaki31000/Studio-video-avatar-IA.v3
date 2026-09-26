---
name: Agnes video constraints
description: Non-obvious Agnes video API limits and output-file requirements for the avatar flow.
---

Agnes v2 keyframes accepts at most three images per video request. In the avatar flow, the primary portrait counts as one, so only two additional scene references can be used.

**Why:** Sending more references causes a deterministic HTTP 400 from the upstream video service, not a transient generation failure.

**How to apply:** Keep the avatar UI and API schema aligned with the three-image total, and validate downloaded MP4s before marking a task completed.