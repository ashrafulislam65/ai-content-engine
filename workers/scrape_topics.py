#!/usr/bin/env python3
"""Fetch trending topics and print them as JSON to stdout.

Uses only the Python standard library, so no pip install is needed.
Each source is isolated: if one fails, the others still return results.
Every topic may carry a short "summary" so the script writer is not guessing from a headline.
"""
import argparse
import concurrent.futures
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

USER_AGENT = "Mozilla/5.0 (compatible; ContentEngineBot/1.0)"
TIMEOUT_SEC = 15
PAGE_TIMEOUT_SEC = 6
REDDIT_SUBS = ["programming", "technology", "webdev", "artificial"]

META_TAG_RE = re.compile(
    r"<meta\b[^>]*?(?:property|name)\s*=\s*[\"'](?:og:description|description)[\"'][^>]*>",
    re.I,
)
CONTENT_RE = re.compile(r"content\s*=\s*(?:\"([^\"]*)\"|'([^']*)')", re.I)


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as res:
        return res.read().decode("utf-8", errors="replace")


def clean_title(title):
    return re.sub(r"\s+", " ", title or "").strip()[:300]


def clean_summary(text):
    text = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    return re.sub(r"\s+", " ", text).strip()[:500]


def parse_traffic(text):
    """Convert strings like '200+', '2K+', '1M+' to an int."""
    if not text:
        return 0
    t = text.strip().replace(",", "").replace("+", "").upper()
    mult = 1
    if t.endswith("K"):
        mult, t = 1_000, t[:-1]
    elif t.endswith("M"):
        mult, t = 1_000_000, t[:-1]
    try:
        return int(float(t) * mult)
    except ValueError:
        return 0


def fetch_description(url):
    """Best effort: the meta description of a web page. Empty string on any failure."""
    if not url or not url.startswith(("http://", "https://")):
        return ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=PAGE_TIMEOUT_SEC) as res:
            raw = res.read(150_000).decode("utf-8", errors="replace")
        for tag in META_TAG_RE.findall(raw):
            m = CONTENT_RE.search(tag)
            if m:
                text = clean_summary(m.group(1) or m.group(2) or "")
                if text:
                    return text
    except Exception:
        pass
    return ""


def hacker_news(limit, errors):
    url = f"https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage={limit}"
    data = json.loads(http_get(url))
    out = []
    for hit in data.get("hits", []):
        title = clean_title(hit.get("title"))
        if len(title) < 3:
            continue
        link = hit.get("url")
        out.append({
            "title": title,
            "source": "HACKER_NEWS",
            "sourceUrl": link or f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
            "score": int(hit.get("points") or 0),
            "summary": clean_summary(hit.get("story_text")) or None,
            "_link": link,
        })

    # Link posts have no text: read the page's meta description (in parallel, short timeout)
    todo = [i for i in out if not i["summary"] and i["_link"]]
    if todo:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            descs = pool.map(fetch_description, [i["_link"] for i in todo])
            for item, desc in zip(todo, descs):
                item["summary"] = desc or None
    for item in out:
        item.pop("_link", None)
    return out


def reddit(limit, errors):
    per_sub = max(5, limit // len(REDDIT_SUBS))
    out = []
    for sub in REDDIT_SUBS:
        try:
            url = f"https://www.reddit.com/r/{sub}/top.json?t=day&limit={per_sub}"
            data = json.loads(http_get(url))
            for child in data["data"]["children"]:
                d = child["data"]
                title = clean_title(d.get("title"))
                if d.get("stickied") or d.get("over_18") or len(title) < 3:
                    continue
                out.append({
                    "title": title,
                    "source": "REDDIT",
                    "sourceUrl": "https://www.reddit.com" + d.get("permalink", ""),
                    "score": int(d.get("score") or 0),
                    "summary": clean_summary(d.get("selftext")) or None,
                })
        except Exception as e:  # one subreddit failing should not kill the rest
            errors.append({"source": f"REDDIT:r/{sub}", "message": str(e)})
    return out


def dev_to(limit, errors):
    url = f"https://dev.to/api/articles?top=3&per_page={limit}"
    data = json.loads(http_get(url))
    out = []
    for article in data:
        title = clean_title(article.get("title"))
        if len(title) < 3:
            continue
        out.append({
            "title": title,
            "source": "DEV_TO",
            "sourceUrl": article.get("url"),
            "score": int(article.get("public_reactions_count") or 0),
            "summary": clean_summary(article.get("description")) or None,
        })
    return out


def google_trends(limit, errors):
    xml_text = http_get("https://trends.google.com/trending/rss?geo=US")
    root = ET.fromstring(xml_text)
    out = []
    for item in root.iter("item"):
        title = clean_title(item.findtext("title"))
        if len(title) < 3:
            continue
        traffic = 0
        for child in item:
            if child.tag.endswith("approx_traffic"):
                traffic = parse_traffic(child.text)
        out.append({
            "title": title,
            "source": "GOOGLE_TRENDS",
            "sourceUrl": item.findtext("link"),
            "score": traffic,
        })
    return out


SOURCES = {
    "hackernews": hacker_news,
    "reddit": reddit,
    "devto": dev_to,
    "google_trends": google_trends,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", default="hackernews,devto")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    topics, errors = [], []
    for name in [s.strip() for s in args.sources.split(",") if s.strip()]:
        fn = SOURCES.get(name)
        if fn is None:
            errors.append({"source": name, "message": "unknown source"})
            continue
        try:
            found = fn(args.limit, errors)
            found.sort(key=lambda t: t["score"], reverse=True)
            topics.extend(found[: args.limit])
        except Exception as e:
            errors.append({"source": name, "message": str(e)})

    # ensure_ascii=True (default) keeps stdout safe on Windows consoles
    print(json.dumps({"topics": topics, "errors": errors}))


if __name__ == "__main__":
    sys.exit(main())