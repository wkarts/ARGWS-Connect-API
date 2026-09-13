# Connect VoIP Engine

Connect-owned video calling implementation, consumed by
`src/api/integrations/channel/whatsapp/voip/connect-voip.plugin.ts`.
Zapo remains responsible for authentication, storage, Signal sessions, device
resolution and the WhatsApp connection through its public plugin interfaces.

The initial source port preserves the reviewed voice behavior of Connect API
1.1.3, including device-addressed acceptance, PN/LID winner selection, terminal
state handling, signaling idempotency and call-key validation. The application
bundles the ESM source files under
`src/api/integrations/channel/whatsapp/voip/engine` directly; they are not a runtime copy or patch of
an installed dependency. JavaScript source and TypeScript declarations are kept
together so protocol changes remain explicit without retranslating the stable
voice implementation during this migration.

`npm run build:connect-voip` produces isolated CommonJS and ESM modules beneath
`.generated/connect-voip` for the existing regression matrix. `npm run test:video`
builds them before running real routers, managers, sessions and cryptography
against simulated native media and network delivery. The production application
does not depend on `.generated`.

The migration passed all 129 existing tests before extending media behavior.
The native audio engine, its installer and all voice regression tests remain
unchanged. A separate video matrix exercises this implementation and
owned-build/provenance/dependency-isolation checks.
Simulated protocol tests do not replace real smartphone, desktop and API-to-API
call interoperability checks.

## Attribution

The initial 21 runtime modules and 21 declaration modules were derived from the
MIT-licensed `@innovatorssoft/voip@1.0.0`, published from
`https://github.com/innovatorssoft/zapo/tree/main/packages/voip`. The upstream
copyright notice is preserved verbatim in `LICENSE`.

`PROVENANCE.json` records hashes of the initial port, including the Connect
corrections already deployed in version 1.1.3. These hashes document origin;
they do not lock later Connect-owned video changes. Subsequent changes are
reviewed and versioned with this repository. The surrounding Connect project
continues under its existing Apache-2.0 license.

The video implementation does not edit `node_modules`. The pre-existing native
audio dependency correction remains in place to preserve its homologated
behavior; video adds no new dependency patch and does not replace that engine.
The parent adapter assigns each call to exactly one engine and filters incoming
handlers so an audio call cannot be processed by the video coordinator.

## Video media contract

Video media derives from [Zapo PR274](https://github.com/vinikjkkj/zapo/pull/274),
commit `062098645ad99e9caeb04e751f58d5ac50639e63`, with the original MIT notice
retained. The PR remains a source reference; Connect neither installs its branch
nor substitutes the native audio implementation.

The owned coordinator accepts H.264 Annex-B access units through
`feedLiveVideo(callId, data, timestampUs)`. The timestamp is in microseconds; RTP
uses the negotiated H.264 payload type 97 and a 90 kHz clock. Incoming frames
are emitted as `voip_call_inbound_video` with `{ call, frame }`, where frame is
`{ codec: 'h264', timestampUs, keyFrame, data }`. These are compressed frames,
not recorded camera images or decoded conversation contents.

`requestVideoKeyFrame(callId)` sends authenticated PLI/FIR feedback to the peer.
Authenticated peer feedback raises `voip_call_video_keyframe_request` with
`{ callId }` for the browser encoder. Malformed or unauthenticated feedback and
replayed media do not reach consumers.

Frame size is limited to 8 MiB, media delivery to 30 fps or a lower configured
`maxVideoFps`, and each relay's video queue to 512 KiB. No disk-backed media
queue is created. Calls dispose timers, frame buffers and encryption contexts
on cleanup. Missing or reordered fragments discard the incomplete frame and
request an IDR. RTX arriving in primary sequence order repairs its original
fragment; the adapter does not retain an unbounded retransmission queue.
