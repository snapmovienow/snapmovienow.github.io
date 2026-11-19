# Segment converter for Apple live playback

The Cloudflare Worker imports a 1,179,301-byte WebAssembly reactor built from FFmpeg 8.1.3 and `segment.c`. Its input is one complete, clear MPEG-TS segment containing H.264 and MP2. It copies H.264 packets, encodes MP2 as stereo or mono AAC-LC and returns separate fMP4 initialization and media bytes. Frame presentation and decoding timestamps come from the source. The optional signed segment time selects the correct cycle of the 33-bit MPEG-TS clock. MPEG-TS timestamps determine audio alignment on a global AAC frame grid. Caller code retains source playlist discontinuities.

## Build and verify

From the repository root on Linux x86_64, run:

```sh
sh tools/apple-segment-codec/build.sh
node tools/apple-segment-codec/verify.mjs
```

The build needs GNU make, tar, xz, curl and SHA-256. The verification needs Node and a native FFmpeg/ffprobe with libx264. Optional local archives can be supplied through `FFMPEG_ARCHIVE` and `WASI_ARCHIVE`. The FFmpeg archive is the release accompanied by a detached signature from FFmpeg's release signing key `FCF986EA15E6E293A5644F10B4322F04D67658D8`. The build verifies both downloaded archives against pinned SHA-256 digests. Upstream FFmpeg tag `n8.1.3` points to commit `1041abdc962f4cc4f394aa8de9dc5236c0c3b9e7`. The compiler is wasi-sdk-25.0, including LLVM/clang 19. Independent builds from the upstream tag and the signed release archive produced SHA-256 `6ec68b67be73b5abf92c7a96b39ceb54ed54164582d2264522bf6d0c928e4d0f`. Do not silently replace the module when changing any build input.

The module is statically linked with LGPL-2.1-or-later FFmpeg libraries. Its license is reproduced in `COPYING.LGPLv2.1`. The C integration is licensed under LGPL-2.1-or-later. The build uses the unmodified upstream sources, configures exactly the components it links and allows rebuilding or modifying the integration. The SDK includes the WASI libc runtime, whose license notices accompany these sources.

## Resource envelope

One fresh instance serves one conversion. The module enables memory I/O only. Filesystem, socket and process access are unavailable to codec code. Input is limited to 8 MiB, 24 seconds of decoded audio, 32 MPEG-TS streams, one or two audio channels at 32, 44.1 or 48 kHz, at most 2,880 video packets and an 80 MiB linear-memory maximum. The caller must serialize conversions within an isolate and bound data before reading to protect the 128 MiB isolate budget. Independent conversions may be performed out of order. The signed sequence determines the MP4 fragment index.

Workerd locally processed a 3.8 MiB H.264/MP2 fragment in about 0.84 s including read and response dispatch and used 29 MiB of WebAssembly memory. This is a local measurement. The verification compares decoded video from the input and converted output, tests AAC continuity across the clock rollover, rejects invalid and oversized input, and checks that a stable source configuration yields a stable initialization segment.

Source archives: [FFmpeg 8.1.3](https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz), [release signature](https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz.asc), [WASI SDK 25](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-25).
