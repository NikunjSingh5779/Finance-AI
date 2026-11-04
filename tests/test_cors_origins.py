import re

from app.main import DEFAULT_CORS_ORIGIN_REGEX


def test_cors_allows_cloudflare_pages_production_and_preview_hosts():
    pattern = re.compile(DEFAULT_CORS_ORIGIN_REGEX)

    assert pattern.fullmatch("https://finance-ai-61h.pages.dev")
    assert pattern.fullmatch(
        "https://fix-realtime-market-data-cha.finance-ai-61h.pages.dev"
    )


def test_cors_still_allows_netlify_previews_and_local_development():
    pattern = re.compile(DEFAULT_CORS_ORIGIN_REGEX)

    assert pattern.fullmatch("https://deploy-preview-9--financeai00.netlify.app")
    assert pattern.fullmatch("http://localhost:3000")


def test_cors_rejects_untrusted_lookalike_pages_domains():
    pattern = re.compile(DEFAULT_CORS_ORIGIN_REGEX)

    assert not pattern.fullmatch("https://finance-ai-61h.pages.dev.attacker.example")
    assert not pattern.fullmatch("https://evil-finance-ai-61h.pages.dev")
