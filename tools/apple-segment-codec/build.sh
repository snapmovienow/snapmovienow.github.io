#!/bin/sh
# SPDX-License-Identifier: LGPL-2.1-or-later
# Rebuild the isolated Worker codec on Linux x86_64. No repository credentials are used.
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:-"$source_dir/../../cloudflare-worker/src/apple-segment-codec.wasm"}
output=$(realpath -m -- "$output")
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT HUP INT TERM
fetch() {
    if [ -n "$1" ]; then cp -- "$1" "$3"; else curl --fail --location --proto '=https' --proto-redir '=https' --retry 2 "$2" -o "$3"; fi
}
fetch "${WASI_ARCHIVE:-}" https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/wasi-sdk-25.0-x86_64-linux.tar.gz "$work/sdk.tgz"
fetch "${FFMPEG_ARCHIVE:-}" https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz "$work/ffmpeg.tar.xz"
(cd "$work" && sha256sum -c <<'SUMS'
52640dde13599bf127a95499e61d6d640256119456d1af8897ab6725bcf3d89c  sdk.tgz
7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3  ffmpeg.tar.xz
SUMS
)
tar -xzf "$work/sdk.tgz" -C "$work"
tar -xJf "$work/ffmpeg.tar.xz" -C "$work"
sdk="$work/wasi-sdk-25.0-x86_64-linux"
cd "$work/ffmpeg-8.1.3"
./configure --cc="$sdk/bin/clang" --cxx="$sdk/bin/clang++" --ar="$sdk/bin/ar" \
    --strip="$sdk/bin/strip" --nm="$sdk/bin/nm" --ranlib="$sdk/bin/ranlib" \
    --arch=wasm32 --target-os=none --enable-cross-compile --disable-everything \
    --disable-autodetect --disable-network --disable-programs --disable-doc --disable-avdevice \
    --disable-swscale --disable-avfilter --disable-pthreads --disable-w32threads --disable-os2threads \
    --disable-inline-asm --disable-asm --enable-small --disable-debug --enable-decoder=mp2float \
    --enable-encoder=aac --enable-parser=h264,mpegaudio --enable-bsf=extract_extradata,aac_adtstoasc \
    --enable-demuxer=mpegts --enable-muxer=mp4 \
    --extra-cflags='-Os -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_MMAN' \
    --extra-libs='-lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-mman'
make -j"${JOBS:-4}"
"$sdk/bin/clang" -Os -mexec-model=reactor -I. "$source_dir/segment.c" \
    -Wl,--export=reserve_input,--export=convert,--export=output_pointer,--export=output_size,--export=init_size,--export=error_detail,--export=diagnostic,--strip-all,--max-memory=83886080,-z,stack-size=524288 \
    libavformat/libavformat.a libavcodec/libavcodec.a libavutil/libavutil.a \
    -lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-mman -lm \
    -o "$work/apple-segment-codec.wasm"
install -m 644 "$work/apple-segment-codec.wasm" "$output"
sha256sum "$output"
