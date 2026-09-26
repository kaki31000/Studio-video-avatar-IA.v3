---
name: Agnes video constraints
description: Non-obvious Agnes video API limits and output-file requirements for the avatar flow.
---

Agnes v2 keyframes accepts at most three images per video request. In the avatar flow, the primary portrait counts as one, so only two additional scene references can be used.

**Why:** Sending more references causes a deterministic HTTP 400 from the upstream video service, not a transient generation failure.

**How to apply:** Keep the avatar UI and API schema aligned with the three-image total, and validate downloaded MP4s before marking a task completed.

For the avatar flow, the uploaded portrait must remain the identity source: bypass the image-to-image regeneration step and submit only that file to Agnes v2.0 as `image` with `mode: "ti2vid"`. A 15-second clip uses `num_frames: 361` at `frame_rate: 24` when the selected dimensions fit the 720p frame tier.

**Why:** Regenerating the portrait can change the mascot/person, while adding scene references switches the request from image-to-video to keyframes. The 15-second frame preset is valid only when the resolution does not move the request into the stricter 1080p frame tier.

**How to apply:** Keep the avatar submission at one reference image and use 1280x720 or 720x1280 for the 16:9/9:16 presets when a 361-frame 15-second request is desired.