# Chinu realistic-edition

- Local branch from GitHub main at `4bb3470`. The backup bundle retains the original history and refs.
- Signed Android preview with the original `com.meraassistant` identity. Open Adventure, then Explore Leh–Ladakh.
- Added two retargeted VRM avatars, the Ladakh route and lighting, vehicle meshes, a two-player minimap, camera and stance controls, and graphics presets.
- Local Gradle build succeeded. Checked the APK signature against the public Chinu release. Chromium smoke tests exercised the scene, vehicle controls, and all five couple interactions over a local two-peer WebRTC connection.
- Physical Android installation, device FPS, animation clipping under touch play, and internet matchmaking remain to be tested. The preview uses the existing on-device Gemini key setting.
- GitHub Actions builds an APK artifact. A production release requires a manual main-branch run with Publish production enabled after approval. Asset attribution and avatar export permission notes are in `realistic/assets/CREDITS.md`.

## Visual and voice follow-up

- Grounded standing VRMs using the animated mesh contact point and the actual rendered terrain. Moved the minimap away from touch targets and redrew the controls.
- Reduced bloom and screen grain, kept the default render at screen resolution or above, added slope-aware rock texture sampling, and lowered the snow line.
- Wake now waits for a complete greeting and name. The overlay opens one listening turn and gives system-command follow-ups only when requested by the command. Accessibility connection and teardown no longer eagerly create or retain the overlay.
- Device microphone behavior and whether Android keeps Accessibility enabled still need validation on the phone.
