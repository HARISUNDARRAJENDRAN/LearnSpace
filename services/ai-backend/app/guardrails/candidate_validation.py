from urllib.parse import parse_qs, urlparse

from app.contracts.discovery import ArxivCandidate, YoutubeCandidate


def youtube_id_from_url(value: str) -> str | None:
    parsed = urlparse(value)
    host = parsed.hostname.lower() if parsed.hostname else ""
    if host == "youtu.be":
        candidate = parsed.path.strip("/")
    elif host.endswith("youtube.com"):
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
    return (
        parsed.scheme == "https"
        and parsed.hostname == "arxiv.org"
        and parsed.path.startswith("/abs/")
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
