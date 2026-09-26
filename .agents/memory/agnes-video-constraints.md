---
name: Agnes video constraints
description: Non-obvious Agnes video API limits and output-file requirements for the avatar flow.
---

Agnes v2 keyframes accepts at most three images per video request. In the avatar flow, the primary portrait counts as one, so only two additional scene references can be used.

**Why:** Sending more references causes a deterministic HTTP 400 from the upstream video service, not a transient generation failure.

**How to apply:** Keep the avatar UI and API schema aligned with the three-image total, and validate downloaded MP4s before marking a task completed.

For the avatar flow, the uploaded portrait must remain the identity source: bypass the image-to-image regeneration step and submit it as the first reference. With no scene photos, Agnes v2.0 receives that file as `image` with `mode: "ti2vid"`; with scene photos, up to two additional images are sent as background/keyframe references. A 15-second clip uses `num_frames: 361` at `frame_rate: 24` when the selected dimensions fit the 720p frame tier.

**Why:** Regenerating the portrait can change the mascot/person. Agnes has no separate background-image field in the v2.0 protocol, so background photos require the supported multi-image keyframe mode and must stay within the three-image limit. The 15-second frame preset is valid only when the resolution does not move the request into the stricter 1080p frame tier.

**How to apply:** Keep the portrait first, cap background references at two, and use 1280x720 or 720x1280 for the 16:9/9:16 presets when a 361-frame 15-second request is desired.

For assembled avatar output, concat-demuxer copying can introduce small timestamp drift (about 0.2 seconds on a 15-second reel). Normalize the assembled reel with a final duration-bounded encode before exposing it as the result.

**Why:** User-selected durations must remain stable across 15/30/45/60-second outputs, including when several trimmed scene clips are concatenated.

**How to apply:** Build the scene sequence from validated 15-second clips, then encode with an explicit `-t` target duration before audio/subtitle composition.