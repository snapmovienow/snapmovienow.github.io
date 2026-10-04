#!/usr/bin/env python3
"""Package a provider stream as HLS audio renditions plus external WebVTT.
Requires ffmpeg and ffprobe on a persistent host. This is a packaging tool,
not a deployed API. Supply the encrypted HTTPS stream URL on stdin.
Usage: python package_tracks.py OUTPUT_DIRECTORY [--seconds 30]
"""
import argparse, json, pathlib, subprocess, sys
from urllib.parse import urlparse

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output")
    parser.add_argument("--seconds", type=float)
    args = parser.parse_args()
    url = sys.stdin.readline().strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "snapmovienow-edge.juancanta89.workers.dev" or parsed.path != "/stream":
        raise SystemExit("Expected an encrypted HTTPS Worker stream URL.")
    if args.seconds is not None and args.seconds <= 0:
        raise SystemExit("Duration must be positive.")
    root = pathlib.Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    def run(command):
        # Never echo a command or provider URL; tickets are access credentials.
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            raise SystemExit("Media processing failed (exit %s)." % result.returncode)
        return result.stdout
    metadata = json.loads(run(["ffprobe", "-v", "error", "-user_agent", "Mozilla/5.0",
        "-show_streams", "-of", "json", url]))
    streams = metadata.get("streams", [])
    videos = [s for s in streams if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")]
    audios = [s for s in streams if s["codec_type"] == "audio"]
    subtitles = [s for s in streams if s["codec_type"] == "subtitle"]
    if not videos or not audios:
        raise SystemExit("No playable video/audio found.")
    command = ["ffmpeg", "-v", "error", "-user_agent", "Mozilla/5.0", "-i", url]
    manifest = {"audio": [], "subtitles": [], "unsupportedSubtitles": []}
    def duration():
        return ["-t", str(args.seconds)] if args.seconds else []
    def hls(stream, name, codec):
        command.extend(duration() + ["-map", "0:%d" % stream["index"], "-c", codec,
            "-f", "hls", "-hls_time", "6", "-hls_list_size", "0",
            "-hls_playlist_type", "vod", "-hls_segment_filename", str(root / (name + "_%05d.ts")),
            "-y", str(root / (name + ".m3u8"))])
    def labels(stream, fallback):
        tags = stream.get("tags", {})
        language = tags.get("language", "und")
        return {"language": language, "label": tags.get("title") or (language if language != "und" else fallback)}
    video = videos[0]
    hls(video, "video", "copy" if video["codec_name"] == "h264" else "libx264")
    for index, stream in enumerate(audios):
        name = "audio_%d" % index
        hls(stream, name, "aac")
        manifest["audio"].append({**labels(stream, "Audio %d" % (index + 1)), "uri": name + ".m3u8"})
    text_codecs = {"ass", "ssa", "subrip", "webvtt", "mov_text", "text"}
    for index, stream in enumerate(subtitles):
        track = {**labels(stream, "Subtitle %d" % (index + 1)), "codec": stream["codec_name"]}
        if stream["codec_name"] not in text_codecs:
            manifest["unsupportedSubtitles"].append(track)
            continue
        name = "subtitle_%d.vtt" % index
        command.extend(duration() + ["-map", "0:%d" % stream["index"], "-c:s", "webvtt", "-y", str(root / name)])
        manifest["subtitles"].append({**track, "uri": name})
    run(command)
    def quote(value):
        return str(value).replace('"', "'").replace("\n", " ").replace("\r", " ")
    master = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for index, track in enumerate(manifest["audio"]):
        master.append('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="%s",LANGUAGE="%s",DEFAULT=%s,AUTOSELECT=YES,URI="%s"' %
            (quote(track["label"]) + " (%d)" % (index + 1), quote(track["language"]), "YES" if index == 0 else "NO", track["uri"]))
    master += ['#EXT-X-STREAM-INF:BANDWIDTH=12000000,AUDIO="audio"', "video.m3u8"]
    (root / "master.m3u8").write_text("\n".join(master) + "\n")
    manifest["url"] = "master.m3u8"
    (root / "tracks.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps({"audio": len(manifest["audio"]), "subtitles": len(manifest["subtitles"]),
        "unsupportedSubtitles": len(manifest["unsupportedSubtitles"])}))
if __name__ == "__main__":
    main()
