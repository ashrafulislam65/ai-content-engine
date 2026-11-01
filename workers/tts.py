#!/usr/bin/env python3
"""Text to speech with edge-tts (free, no API key).

Reads the script text from stdin (UTF-8) and writes into --out-dir:
  voice.mp3      the narration
  subtitles.srt  short caption cues (about 3 words each when word timestamps exist)
  words.json     per-word timings, for karaoke-style captions later
Prints one JSON object describing the result.

Usage:
  python tts.py --out-dir DIR --voice en-US-AndrewNeural --rate=+0%   (text on stdin)
  python tts.py --list-voices en-US
"""
import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

TICKS_PER_SEC = 10_000_000  # edge-tts offsets/durations are in 100-nanosecond units
FALLBACK_VOICES = ["en-US-GuyNeural", "en-US-AriaNeural"]
WORDS_PER_CUE = 3


def fmt_ts(sec):
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def tidy(text):
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,!?;:])", r"\1", text)


def attach_punctuation(text, words):
    """edge-tts word timings carry no punctuation. Find each word in the original text
    (in order) and remember the punctuation that follows it, so captions can break at
    sentence ends and read naturally."""
    pos = 0
    for w in words:
        pattern = r"(?<![\w'])" + re.escape(w["text"]) + r"(?![\w'])"
        m = re.compile(pattern).search(text, pos)
        if not m:
            continue
        pos = m.end()
        w["punct"] = re.match(r"[.,!?;:\"')\]]*", text[pos:]).group(0)


def make_cue(group):
    parts = [w["text"] + w.get("punct", "") for w in group]
    return {
        "text": tidy(" ".join(parts)),
        "start": group[0]["start"],
        "end": group[-1]["end"],
    }


def build_cues(words, sentences):
    if words:
        cues, group = [], []
        for w in words:
            group.append(w)
            punct = w.get("punct", "")
            sentence_end = re.search(r"[.!?]", punct) is not None
            soft_break = len(group) >= 2 and re.search(r"[,;:]", punct) is not None
            # a cue ends after 3 words, at the end of a sentence, or at a comma
            if len(group) >= WORDS_PER_CUE or sentence_end or soft_break:
                cues.append(make_cue(group))
                group = []
        if group:
            cues.append(make_cue(group))
    else:
        cues = [
            {"text": tidy(s["text"]), "start": s["start"], "end": s["end"]}
            for s in sentences
        ]
    # no flicker: if the gap to the next cue is small, hold this cue until the next starts
    for cur, nxt in zip(cues, cues[1:]):
        if 0 <= nxt["start"] - cur["end"] < 0.35:
            cur["end"] = nxt["start"]
    return cues


def write_srt(path, cues):
    blocks = [
        f"{i}\n{fmt_ts(c['start'])} --> {fmt_ts(c['end'])}\n{c['text']}\n"
        for i, c in enumerate(cues, 1)
    ]
    path.write_text("\n".join(blocks), encoding="utf-8")


async def synthesize(text, voice, rate, mp3_path):
    import edge_tts

    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    except TypeError:  # older edge-tts without the boundary option
        communicate = edge_tts.Communicate(text, voice, rate=rate)

    words, sentences = [], []
    got_audio = False
    with open(mp3_path, "wb") as f:
        async for chunk in communicate.stream():
            kind = chunk["type"]
            if kind == "audio":
                got_audio = True
                f.write(chunk["data"])
            elif kind in ("WordBoundary", "SentenceBoundary"):
                start = chunk["offset"] / TICKS_PER_SEC
                end = start + chunk["duration"] / TICKS_PER_SEC
                item = {"text": chunk["text"], "start": round(start, 3), "end": round(end, 3)}
                (words if kind == "WordBoundary" else sentences).append(item)
    if not got_audio:
        raise RuntimeError("no audio received")
    return words, sentences


async def list_voices(prefix):
    import edge_tts

    voices = await edge_tts.list_voices()
    for v in sorted(voices, key=lambda v: v["ShortName"]):
        if v["ShortName"].lower().startswith(prefix.lower()):
            print(f"{v['ShortName']:<34} {v['Gender']}")


async def run(args):
    text = sys.stdin.buffer.read().decode("utf-8").strip()
    if not text:
        raise ValueError("empty text on stdin")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    mp3_path = out_dir / "voice.mp3"

    used_voice, last_error = None, None
    words, sentences = [], []
    for voice in [args.voice] + [v for v in FALLBACK_VOICES if v != args.voice]:
        try:
            words, sentences = await synthesize(text, voice, args.rate, mp3_path)
            used_voice = voice
            break
        except Exception as e:
            last_error = f"{voice}: {e}"
            print(f"voice failed -> {last_error}", file=sys.stderr)
    if used_voice is None:
        raise RuntimeError(f"all voices failed, last error: {last_error}")

    attach_punctuation(text, words)
    cues = build_cues(words, sentences)
    srt_path = out_dir / "subtitles.srt"
    write_srt(srt_path, cues)

    words_path = out_dir / "words.json"
    words_path.write_text(json.dumps(words or sentences), encoding="utf-8")

    timings = words or sentences
    if timings:
        duration = max(t["end"] for t in timings) + 0.3
    else:  # no timestamps at all: rough estimate, ~2.6 words per second
        duration = len(text.split()) / 2.6

    print(json.dumps({
        "audioFile": str(mp3_path),
        "srtFile": str(srt_path),
        "wordsFile": str(words_path),
        "durationSec": round(duration, 2),
        "boundary": "word" if words else ("sentence" if sentences else "none"),
        "voice": used_voice,
    }))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir")
    parser.add_argument("--voice", default="en-US-AndrewNeural")
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--list-voices", metavar="PREFIX")
    args = parser.parse_args()

    try:
        if args.list_voices is not None:
            asyncio.run(list_voices(args.list_voices))
        else:
            if not args.out_dir:
                parser.error("--out-dir is required")
            asyncio.run(run(args))
    except Exception as e:
        print(f"tts failed: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
