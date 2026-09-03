import re
from urllib.parse import parse_qs, urlparse

from app.contracts.discovery import ArxivCandidate, YoutubeCandidate


def youtube_id_from_url(value: str) -> str | None:
    parsed = urlparse(value)
    host = parsed.hostname.lower() if parsed.hostname else ""
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port:
        return None
    if host == "youtu.be":
        candidate = parsed.path.strip("/")
    elif host == "youtube.com" or host.endswith(".youtube.com"):
        candidate = parse_qs(parsed.query).get("v", [""])[0]
        if not candidate:
            parts = parsed.path.strip("/").split("/")
            candidate = (
                parts[1] if len(parts) > 1 and parts[0] in {"shorts", "embed", "live"} else ""
            )
    else:
        return None
    return (
        candidate
        if len(candidate) == 11
        and all(character.isalnum() or character in "_-" for character in candidate)
        else None
    )


def is_allowed_arxiv_url(value: str) -> bool:
    parsed = urlparse(value)
    arxiv_id = parsed.path.removeprefix("/abs/")
    return (
        parsed.scheme == "https"
        and parsed.hostname == "arxiv.org"
        and not parsed.username
        and not parsed.password
        and not parsed.port
        and not parsed.query
        and not parsed.fragment
        and re.fullmatch(
            r"(?:[A-Za-z][A-Za-z0-9.-]{1,31}/\d{7}|\d{4}\.\d{4,5}(?:v\d+)?)",
            arxiv_id,
        ) is not None
    )


def validate_youtube_candidate(candidate: YoutubeCandidate) -> YoutubeCandidate | None:
    if youtube_id_from_url(candidate.canonical_url) != candidate.youtube_id:
        return None
    if candidate.source not in {"exa", "youtube-content"} or candidate.confidence < 0.5:
        return None
    return candidate


def validate_arxiv_candidate(candidate: ArxivCandidate) -> ArxivCandidate | None:
    if not is_allowed_arxiv_url(candidate.canonical_url) or candidate.confidence < 0.5:
        return None
    return candidate
