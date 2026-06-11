#!/usr/bin/env python3
"""
TCG Watcher - Maxirêves OP17
Surveillance propre et légère pour détecter OP17 / OP-17 sur Maxirêves
et envoyer des alertes Discord.

Python: 3.13+
Dépendances: aucune librairie externe.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


DEFAULT_CONFIG_PATH = "config/watchlist.json"
DEFAULT_STATE_PATH = "state/watch_state.json"


class TextAndLinksParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._current_href: str | None = None
        self._current_text: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        if tag_l in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
            return

        attrs_dict = {k.lower(): v for k, v in attrs if v is not None}
        if tag_l == "a" and attrs_dict.get("href"):
            self._current_href = attrs_dict["href"]
            self._current_text = []

        if tag_l in {"br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        if self._skip_depth and tag_l in {"script", "style", "noscript", "svg"}:
            self._skip_depth -= 1
            return

        if tag_l == "a" and self._current_href:
            label = " ".join(self._current_text).strip()
            self.links.append((self._current_href, label))
            self._current_href = None
            self._current_text = []

        if tag_l in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = html.unescape(data)
        if text.strip():
            self.parts.append(text)
            if self._current_href:
                self._current_text.append(text)


def normalize(text: str) -> str:
    text = html.unescape(text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()


@dataclass
class FetchResult:
    url: str
    status: int
    final_url: str
    html_text: str | None
    etag: str | None
    last_modified: str | None
    not_modified: bool = False


def fetch_url(url: str, state_for_url: dict[str, Any], config: dict[str, Any]) -> FetchResult:
    timeout = int(config.get("politeness", {}).get("timeout_seconds", 20))
    user_agent = os.getenv(
        "WATCHER_USER_AGENT",
        config.get("politeness", {}).get(
            "user_agent",
            "TCGWatcher/1.0 (+personal stock alert; respectful polling)",
        ),
    )

    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }

    if state_for_url.get("etag"):
        headers["If-None-Match"] = state_for_url["etag"]
    if state_for_url.get("last_modified"):
        headers["If-Modified-Since"] = state_for_url["last_modified"]

    req = urllib.request.Request(url, headers=headers, method="GET")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            charset = response.headers.get_content_charset() or "utf-8"
            text = raw.decode(charset, errors="replace")
            return FetchResult(
                url=url,
                status=int(response.status),
                final_url=response.geturl(),
                html_text=text,
                etag=response.headers.get("ETag"),
                last_modified=response.headers.get("Last-Modified"),
                not_modified=False,
            )
    except urllib.error.HTTPError as exc:
        if exc.code == 304:
            return FetchResult(
                url=url,
                status=304,
                final_url=url,
                html_text=None,
                etag=state_for_url.get("etag"),
                last_modified=state_for_url.get("last_modified"),
                not_modified=True,
            )
        raise


def html_to_text_and_links(raw_html: str, base_url: str) -> tuple[str, list[tuple[str, str]]]:
    parser = TextAndLinksParser()
    parser.feed(raw_html)
    text = " ".join(parser.parts)
    text = re.sub(r"\s+", " ", html.unescape(text)).strip()

    links: list[tuple[str, str]] = []
    for href, label in parser.links:
        abs_url = urllib.parse.urljoin(base_url, href)
        links.append((abs_url, re.sub(r"\s+", " ", label).strip()))

    return text, links


def extract_prices(text: str) -> list[float]:
    """
    Exemples supportés:
    - 120€
    - 120,00 €
    - 1 440,00€
    - 1.560,00 €
    """
    prices: list[float] = []
    # Prix avec centimes
    for match in re.finditer(r"(?<!\w)(\d{1,3}(?:[ .]\d{3})*|\d{2,5})\s*[,.]\s*(\d{2})\s*€", text):
        euros = match.group(1).replace(" ", "").replace(".", "")
        cents = match.group(2)
        try:
            prices.append(float(f"{euros}.{cents}"))
        except ValueError:
            pass

    # Prix sans centimes
    for match in re.finditer(r"(?<![\w,.])(\d{2,5})\s*€", text):
        try:
            value = float(match.group(1))
        except ValueError:
            continue
        # Évite de dupliquer 120 dans "120,00 €"
        start, end = match.span()
        surrounding = text[max(0, start - 2): min(len(text), end + 4)]
        if re.search(r"\d\s*[,\.]\s*\d{2}\s*€", surrounding):
            continue
        prices.append(value)

    # Déduplication en gardant l'ordre
    deduped: list[float] = []
    for price in prices:
        if price not in deduped:
            deduped.append(price)
    # Ignore les faux prix WooCommerce type 0,00 € (panier/livraison/placeholder).
    return [p for p in deduped if p >= 10.0]


def find_contexts(full_text: str, watch_terms: list[str], window: int = 900) -> list[str]:
    norm_full = normalize(full_text)
    contexts: list[str] = []
    patterns = []
    for term in watch_terms:
        term_norm = normalize(term)
        if term_norm == "op17":
            patterns.append(r"\bop[-\s]?17\b")
        else:
            patterns.append(re.escape(term_norm))

    for pattern in patterns:
        for match in re.finditer(pattern, norm_full, flags=re.IGNORECASE):
            start = max(0, match.start() - window)
            end = min(len(norm_full), match.end() + window)
            snippet = norm_full[start:end]
            if snippet not in contexts:
                contexts.append(snippet)

    return contexts


def relevant_links(links: list[tuple[str, str]], watch_terms: list[str]) -> list[str]:
    """Liens utiles OP17.

    On garde surtout les vraies fiches produit Maxirêves (/produit/).
    Cela évite les faux positifs des pages de recherche du type ?s=OP17,
    qui contiennent le mot OP17 uniquement parce qu'on l'a cherché.
    """
    out: list[str] = []
    for href, label in links:
        hay = normalize(href + " " + label)
        is_op17 = bool(re.search(r"\bop[-\s]?17\b", hay))
        is_product_url = "/produit/" in href or "/product/" in href
        is_search_url = "?s=op17" in hay or "?s=op-17" in hay
        if is_op17 and is_product_url and not is_search_url:
            if href not in out:
                out.append(href)
    return out[:8]


def context_is_actionable_enough(result: dict[str, Any], links_found: list[str], config: dict[str, Any]) -> bool:
    """Filtre anti-faux positifs.

    Alerte uniquement si OP17 ressemble à une vraie offre produit:
    - lien fiche produit OP17 détecté, ou
    - type display/case + stock/préco détecté, ou
    - prix produit réel détecté + stock/préco détecté.

    On ne bloque PAS sur le prix: on filtre seulement les pages vides/recherche/footer.
    """
    has_product_link = bool(links_found)
    has_product_shape = bool(result.get("is_display") or result.get("is_case") or result.get("prices"))
    has_stock_signal = bool(result.get("is_available") or result.get("is_preorder"))
    is_unavailable = bool(result.get("is_unavailable"))

    # La vraie alerte stock/préco doit avoir un signal actionnable et ne pas être purement rupture.
    if has_stock_signal and not is_unavailable and (has_product_link or has_product_shape):
        return True

    # Optionnel: alerter à la simple apparition d'une fiche produit OP17 même sans stock lu.
    if config.get("alerting", {}).get("send_alert_when_op17_detected_without_stock", False):
        return has_product_link and has_product_shape

    return False


def has_any(text: str, keywords: list[str]) -> bool:
    norm = normalize(text)
    return any(normalize(k) in norm for k in keywords)


def evaluate_context(context: str, config: dict[str, Any]) -> dict[str, Any]:
    rules = config["rules"]
    thresholds = config["thresholds"]

    prices = extract_prices(context)
    has_fr = has_any(context, rules["fr_keywords"])
    has_en = has_any(context, rules["non_fr_keywords"])
    is_case = has_any(context, rules["case_keywords"])
    is_display = has_any(context, rules["display_keywords"])
    is_available = has_any(context, rules["available_keywords"])
    is_unavailable = has_any(context, rules["unavailable_keywords"])
    is_preorder = has_any(context, rules["preorder_keywords"])

    display_prices = [p for p in prices if p < 500]
    case_prices = [p for p in prices if p >= 500]

    max_display = float(thresholds["max_display_price_eur"])
    max_case = float(thresholds["max_case_price_eur"])
    alerting = config.get("alerting", {})
    ignore_price_for_stock_alerts = bool(alerting.get("ignore_price_for_stock_alerts", False))

    verdict = "SURVEILLER"
    reasons: list[str] = []

    if has_en and not has_fr:
        verdict = "EVITER"
        reasons.append("Langue EN/non-FR détectée ou FR non confirmé.")
    elif not has_fr:
        verdict = "SURVEILLER"
        reasons.append("OP17 détecté mais FR non confirmé : vérifier avant achat.")
    elif ignore_price_for_stock_alerts and (is_available or is_preorder) and not is_unavailable:
        verdict = "STOCK_DETECTE"
        reasons.append("OP17 FR semble stock/précommande actionnable : alerte envoyée quel que soit le prix.")
        if is_case:
            reasons.append("Produit potentiellement case : vérifier case scellée 12 displays avant paiement.")
        elif is_display or display_prices:
            reasons.append("Produit potentiellement display : vérifier 24 boosters FR avant paiement.")
        if prices:
            reasons.append(f"Prix lu à vérifier manuellement : {min(prices):.2f} €.")
        else:
            reasons.append("Prix non lu automatiquement : ouvrir la fiche.")
    elif is_unavailable and not is_available:
        verdict = "SURVEILLER"
        reasons.append("OP17 FR détecté mais stock/précommande non actionnable.")
    elif is_case:
        if case_prices and min(case_prices) <= max_case and (is_available or is_preorder):
            verdict = "ACHETER_MAINTENANT"
            reasons.append(f"Case OP17 FR potentielle dans le seuil ≤ {max_case:.0f} €.")
        elif case_prices:
            verdict = "EVITER"
            reasons.append(f"Case OP17 FR potentielle mais prix > {max_case:.0f} €.")
        else:
            verdict = "SURVEILLER"
            reasons.append("Case OP17 FR potentielle, prix non lu.")
    elif is_display or display_prices:
        if display_prices and min(display_prices) <= max_display and (is_available or is_preorder):
            verdict = "ACHETER_MAINTENANT"
            reasons.append(f"Display OP17 FR potentiel dans le seuil ≤ {max_display:.0f} €.")
        elif display_prices:
            verdict = "EVITER" if min(display_prices) > max_display else "SURVEILLER"
            reasons.append(f"Display OP17 FR potentiel, prix détecté {min(display_prices):.2f} €.")
        else:
            verdict = "SURVEILLER"
            reasons.append("Display OP17 FR potentiel, prix non lu.")
    else:
        verdict = "SURVEILLER"
        reasons.append("OP17 détecté, type produit à vérifier.")

    return {
        "verdict": verdict,
        "prices": prices,
        "display_prices": display_prices,
        "case_prices": case_prices,
        "has_fr": has_fr,
        "has_en": has_en,
        "is_case": is_case,
        "is_display": is_display,
        "is_available": is_available,
        "is_unavailable": is_unavailable,
        "is_preorder": is_preorder,
        "reasons": reasons,
        "context_preview": context[:900],
    }


def build_discord_payload(
    target_name: str,
    url: str,
    result: dict[str, Any],
    links: list[str],
    config: dict[str, Any],
) -> dict[str, Any]:
    thresholds = config["thresholds"]
    verdict = result["verdict"]

    emoji = {
        "STOCK_DETECTE": "🔔",
        "ACHETER_MAINTENANT": "🚨",
        "SURVEILLER": "🟡",
        "EVITER": "🔴",
    }.get(verdict, "ℹ️")

    color = {
        "STOCK_DETECTE": 0x3498DB,
        "ACHETER_MAINTENANT": 0x2ECC71,
        "SURVEILLER": 0xF1C40F,
        "EVITER": 0xE74C3C,
    }.get(verdict, 0x95A5A6)

    reasons = "\n".join(f"• {r}" for r in result["reasons"])
    prices = ", ".join(f"{p:.2f} €" for p in result["prices"]) or "aucun prix lu"

    checks = [
        f"FR détecté: {'oui' if result['has_fr'] else 'non'}",
        f"EN/non-FR détecté: {'oui' if result['has_en'] else 'non'}",
        f"Case: {'oui' if result['is_case'] else 'non'}",
        f"Display: {'oui' if result['is_display'] else 'non'}",
        f"Actionnable/préco: {'oui' if result['is_available'] or result['is_preorder'] else 'non'}",
        f"Rupture/indispo: {'oui' if result['is_unavailable'] else 'non'}",
    ]

    linked = "\n".join(links[:5]) if links else "Aucun lien produit OP17 isolé, ouvre la page source."

    content = (
        f"{emoji} **{verdict}** — Maxirêves OP17\n"
        f"{target_name}\n"
        f"{url}"
    )

    embed = {
        "title": f"{emoji} Alerte OP17 Maxirêves — {verdict}",
        "url": url,
        "color": color,
        "fields": [
            {"name": "Pourquoi", "value": reasons[:1024] or "OP17 détecté.", "inline": False},
            {"name": "Prix détectés", "value": prices[:1024], "inline": True},
            {
                "name": "Seuils",
                "value": (
                    f"Display max indicatif: {thresholds['max_display_price_eur']} €\n"
                    f"Case max indicatif: {thresholds['max_case_price_eur']} €\n"
                    "Mode: alerte stock quel que soit le prix"
                ),
                "inline": True,
            },
            {"name": "Checks", "value": "\n".join(checks)[:1024], "inline": False},
            {"name": "Liens repérés", "value": linked[:1024], "inline": False},
            {
                "name": "À vérifier avant paiement",
                "value": (
                    "Langue FR explicite, case scellée 12 displays si case, "
                    "prix total avec frais, ajout panier, paiement protégé, "
                    "conditions de précommande/remboursement."
                ),
                "inline": False,
            },
        ],
        "timestamp": dt.datetime.now(dt.UTC).isoformat(),
    }

    return {"content": content[:1900], "embeds": [embed]}


def send_discord(payload: dict[str, Any]) -> None:
    webhook = os.getenv("DISCORD_WEBHOOK_URL")
    if not webhook:
        print("DISCORD_WEBHOOK_URL absent : notification non envoyée.")
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        webhook,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "TCGWatcher/1.0 DiscordNotifier",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        if response.status not in {200, 204}:
            raise RuntimeError(f"Discord webhook status inattendu: {response.status}")


def test_discord() -> None:
    payload = {
        "content": "✅ TCG Watcher connecté à Discord. Les alertes OP17 Maxirêves arriveront ici.",
        "embeds": [
            {
                "title": "Test OK",
                "description": "Webhook Discord opérationnel.",
                "color": 0x2ECC71,
                "timestamp": dt.datetime.now(dt.UTC).isoformat(),
            }
        ],
    }
    send_discord(payload)
    print("Test Discord envoyé.")


def run_once(config_path: Path, state_path: Path, dry_run: bool = False) -> int:
    config = load_json(config_path, {})
    if not config:
        raise SystemExit(f"Config introuvable ou invalide: {config_path}")

    state = load_json(state_path, {"urls": {}, "alerts": []})
    state.setdefault("urls", {})
    state.setdefault("alerts", [])

    watch_terms = config["watch_terms"]
    delay = float(config.get("politeness", {}).get("delay_between_requests_seconds", 2.0))
    jitter = float(config.get("politeness", {}).get("jitter_seconds", 1.5))
    max_alert_history = int(config.get("politeness", {}).get("max_alert_history", 80))

    sent_count = 0

    for index, target in enumerate(config["targets"]):
        name = target["name"]
        url = target["url"]
        url_state = state["urls"].setdefault(url, {})

        try:
            fetched = fetch_url(url, url_state, config)
            now = dt.datetime.now(dt.UTC).isoformat()

            url_state["last_checked_utc"] = now
            url_state["last_status"] = fetched.status

            if fetched.etag:
                url_state["etag"] = fetched.etag
            if fetched.last_modified:
                url_state["last_modified"] = fetched.last_modified

            if fetched.not_modified:
                print(f"[304] {name} — pas modifié")
            else:
                assert fetched.html_text is not None
                page_hash = sha256_text(fetched.html_text)
                url_state["last_hash"] = page_hash

                text, links = html_to_text_and_links(fetched.html_text, fetched.final_url)
                contexts = find_contexts(text, watch_terms)

                print(f"[{fetched.status}] {name} — contexts OP17: {len(contexts)}")

                if contexts:
                    # On évalue le meilleur contexte: priorité achat, puis surveillance, puis éviter.
                    evaluated = [evaluate_context(c, config) for c in contexts]
                    priority = {"STOCK_DETECTE": 0, "ACHETER_MAINTENANT": 1, "SURVEILLER": 2, "EVITER": 3}
                    evaluated.sort(key=lambda r: priority.get(r["verdict"], 9))
                    best = evaluated[0]

                    links_found = relevant_links(links, watch_terms)

                    if not context_is_actionable_enough(best, links_found, config):
                        print(
                            f"[SKIP] {name} — OP17 vu, mais pas de fiche produit/stock actionnable "
                            "(probable page recherche ou bruit de page)"
                        )
                        continue

                    alert_signature = sha256_text(
                        json.dumps(
                            {
                                "url": url,
                                "page_hash": page_hash,
                                "verdict": best["verdict"],
                                "prices": best["prices"],
                                "has_fr": best["has_fr"],
                                "links": links_found[:3],
                            },
                            ensure_ascii=False,
                            sort_keys=True,
                        )
                    )

                    previous_alerts = set(url_state.get("alert_signatures", []))
                    if alert_signature not in previous_alerts:
                        payload = build_discord_payload(name, fetched.final_url, best, links_found, config)
                        if dry_run:
                            print(json.dumps(payload, ensure_ascii=False, indent=2))
                        else:
                            send_discord(payload)
                        sent_count += 1

                        url_state.setdefault("alert_signatures", []).append(alert_signature)
                        url_state["alert_signatures"] = url_state["alert_signatures"][-max_alert_history:]
                        state["alerts"].append(
                            {
                                "time_utc": now,
                                "target": name,
                                "url": url,
                                "verdict": best["verdict"],
                                "prices": best["prices"],
                            }
                        )
                        state["alerts"] = state["alerts"][-max_alert_history:]
                    else:
                        print(f"[SKIP] {name} — alerte déjà envoyée pour cet état")
        except Exception as exc:
            print(f"[ERREUR] {name}: {exc}", file=sys.stderr)
            url_state["last_error_utc"] = dt.datetime.now(dt.UTC).isoformat()
            url_state["last_error"] = repr(exc)

        if index < len(config["targets"]) - 1:
            time.sleep(delay + random.uniform(0, jitter))

    save_json(state_path, state)
    print(f"Run terminé. Alertes envoyées: {sent_count}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Surveille Maxirêves OP17 et alerte Discord.")
    parser.add_argument("--config", default=DEFAULT_CONFIG_PATH, help="Chemin config JSON.")
    parser.add_argument("--state", default=DEFAULT_STATE_PATH, help="Chemin état JSON.")
    parser.add_argument("--dry-run", action="store_true", help="Affiche les alertes sans envoyer Discord.")
    parser.add_argument("--test-discord", action="store_true", help="Envoie un message de test Discord.")
    args = parser.parse_args()

    if args.test_discord:
        test_discord()
        return 0

    return run_once(Path(args.config), Path(args.state), dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
