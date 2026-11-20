#!/usr/bin/env python3
"""Receive landing leads locally and deliver them to amoCRM from the server."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import signal
import sqlite3
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen


DEFAULT_DB_PATH = "/var/lib/kolvika-leads/leads.sqlite3"
DEFAULT_PORT = 3210
MAX_BODY_SIZE = 32 * 1024
MAX_UTM_FIELDS = 32
ALLOWED_HOSTS = {
    "custom.kolvika.jewelry",
    "repair.kolvika.jewelry",
    "quiz.kolvika.jewelry",
}
UTM_KEY_RE = re.compile(r"^utm_[a-z0-9_]{1,63}$", re.IGNORECASE)
stop_worker = threading.Event()
delivery_lock = threading.Lock()
token_lock = threading.Lock()
rate_lock = threading.Lock()
recent_requests: dict[str, list[float]] = {}
RATE_LIMIT_PER_MINUTE = 20


class LeadInputError(ValueError):
    pass


class AmoCRMError(RuntimeError):
    def __init__(self, code: str, retryable: bool = True):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def db_path() -> Path:
    return Path(os.environ.get("LEADS_DB_PATH", DEFAULT_DB_PATH))


def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def init_db() -> None:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path, timeout=10) as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS leads (
                request_id TEXT PRIMARY KEY,
                received_at TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                amo_status TEXT NOT NULL DEFAULT 'queued',
                amo_attempts INTEGER NOT NULL DEFAULT 0,
                amo_next_attempt_at REAL NOT NULL DEFAULT 0,
                amo_lead_id INTEGER,
                amo_note_sent INTEGER NOT NULL DEFAULT 0,
                amo_last_error TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS leads_delivery_queue "
            "ON leads(amo_status, amo_next_attempt_at, received_at)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        # Recover jobs interrupted by a service restart. request_id prevents
        # repeated browser submissions from entering the local queue twice.
        conn.execute(
            "UPDATE leads SET amo_status = 'queued', amo_next_attempt_at = 0 "
            "WHERE amo_status = 'sending'"
        )


def clean_text(value: Any, limit: int) -> str:
    if not isinstance(value, (str, int, float)):
        return ""
    return " ".join(str(value).replace("\x00", "").split())[:limit]


def normalize_lead(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise LeadInputError("body_must_be_object")

    request_id = clean_text(payload.get("request_id"), 64)
    try:
        if str(uuid.UUID(request_id)) != request_id.lower():
            raise ValueError("non_canonical_uuid")
    except (ValueError, AttributeError):
        raise LeadInputError("invalid_request_id") from None

    phone = clean_text(payload.get("phone"), 80)
    if len(phone) < 5:
        raise LeadInputError("phone_required")

    utm_raw = payload.get("utm", {})
    if not isinstance(utm_raw, dict):
        raise LeadInputError("utm_must_be_object")
    utm: dict[str, str] = {}
    for key, value in list(utm_raw.items())[:MAX_UTM_FIELDS]:
        if isinstance(key, str) and UTM_KEY_RE.fullmatch(key):
            normalized_key = key.lower()
            normalized_value = clean_text(value, 1024)
            if normalized_value:
                utm[normalized_key] = normalized_value

    return {
        "request_id": request_id.lower(),
        "received_at": datetime.now(timezone.utc).isoformat(),
        "landing": clean_text(payload.get("landing"), 200),
        "type": clean_text(payload.get("type"), 200) or "Заявка с сайта",
        "name": clean_text(payload.get("name"), 200),
        "phone": phone,
        "message": clean_text(payload.get("message"), 4000),
        "page": clean_text(payload.get("page"), 2048),
        "referrer": clean_text(payload.get("referrer"), 2048),
        "ym_client_id": clean_text(payload.get("ym_client_id"), 40),
        "utm": utm,
    }


def store_lead(lead: dict[str, Any]) -> tuple[bool, bool]:
    serialized = json.dumps(lead, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    hash_payload = {key: value for key, value in lead.items() if key != "received_at"}
    canonical_payload = json.dumps(
        hash_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    digest = hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest()
    with connect_db() as conn:
        existing = conn.execute(
            "SELECT payload_hash FROM leads WHERE request_id = ?",
            (lead["request_id"],),
        ).fetchone()
        if existing:
            if existing["payload_hash"] != digest:
                return False, False
            return True, True
        conn.execute(
            """
            INSERT INTO leads (request_id, received_at, payload_json, payload_hash)
            VALUES (?, ?, ?, ?)
            """,
            (lead["request_id"], lead["received_at"], serialized, digest),
        )
    return True, False


def request_origin_allowed(handler: BaseHTTPRequestHandler) -> bool:
    origin = (handler.headers.get("Origin") or "").rstrip("/").lower()
    allowed_origins = {
        "https://custom.kolvika.jewelry",
        "https://repair.kolvika.jewelry",
        "https://quiz.kolvika.jewelry",
    }
    if origin:
        return origin in allowed_origins

    # Same-origin non-browser clients may omit Origin. Keep the service bound
    # to localhost and require Nginx to forward the expected host and scheme.
    host = urlsplit("//" + (handler.headers.get("Host") or "")).hostname
    proto = (handler.headers.get("X-Forwarded-Proto") or "").lower()
    return bool(host and host.lower() in ALLOWED_HOSTS and proto == "https")


def rate_limited(handler: BaseHTTPRequestHandler) -> bool:
    client_ip = handler.headers.get("X-Real-IP") or handler.client_address[0]
    now = time.time()
    with rate_lock:
        recent = [stamp for stamp in recent_requests.get(client_ip, []) if stamp > now - 60]
        if len(recent) >= RATE_LIMIT_PER_MINUTE:
            recent_requests[client_ip] = recent
            return True
        recent.append(now)
        recent_requests[client_ip] = recent
        if len(recent_requests) > 5000:
            for address in list(recent_requests):
                if not any(stamp > now - 60 for stamp in recent_requests[address]):
                    del recent_requests[address]
    return False


def get_state(key: str) -> str | None:
    with connect_db() as conn:
        row = conn.execute("SELECT value FROM app_state WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None


def set_state(values: dict[str, str]) -> None:
    with connect_db() as conn:
        conn.executemany(
            "INSERT INTO app_state(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            list(values.items()),
        )


def oauth_app_configured() -> bool:
    required = (
        "AMOCRM_ACCOUNT_URL",
        "AMOCRM_CLIENT_ID",
        "AMOCRM_CLIENT_SECRET",
        "AMOCRM_REDIRECT_URI",
    )
    return all(os.environ.get(key, "").strip() for key in required)


def create_oauth_authorization_url() -> str:
    if not oauth_app_configured():
        raise AmoCRMError("oauth_app_not_configured", retryable=False)
    state = secrets.token_urlsafe(32)
    set_state({
        "oauth_setup_state": state,
        "oauth_setup_expires_at": str(time.time() + 15 * 60),
    })
    params = urlencode({"client_id": os.environ["AMOCRM_CLIENT_ID"], "state": state})
    return "https://www.amocrm.ru/oauth?" + params


def consume_oauth_state(state: str) -> bool:
    with connect_db() as conn:
        row = conn.execute(
            "SELECT value FROM app_state WHERE key = 'oauth_setup_state'"
        ).fetchone()
        expires = conn.execute(
            "SELECT value FROM app_state WHERE key = 'oauth_setup_expires_at'"
        ).fetchone()
        if not row or not expires or not secrets.compare_digest(row["value"], state):
            return False
        try:
            if float(expires["value"]) <= time.time():
                return False
        except ValueError:
            return False
        updated = conn.execute(
            "UPDATE app_state SET value = '' "
            "WHERE key = 'oauth_setup_state' AND value = ?",
            (state,),
        )
        return updated.rowcount == 1


def exchange_authorization_code(code: str) -> None:
    if not oauth_app_configured():
        raise AmoCRMError("oauth_app_not_configured", retryable=False)
    body = json.dumps({
        "client_id": os.environ["AMOCRM_CLIENT_ID"],
        "client_secret": os.environ["AMOCRM_CLIENT_SECRET"],
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": os.environ["AMOCRM_REDIRECT_URI"],
    }).encode("utf-8")
    request = Request(
        amo_base_url() + "/oauth2/access_token",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            tokens = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise AmoCRMError(
            "oauth_code_http_" + str(error.code),
            retryable=error.code == 429 or error.code >= 500,
        ) from None
    except (URLError, TimeoutError, json.JSONDecodeError):
        raise AmoCRMError("oauth_code_network_or_response_error") from None

    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    expires_in = tokens.get("expires_in")
    if not access_token or not refresh_token or not isinstance(expires_in, (int, float)):
        raise AmoCRMError("oauth_code_invalid_token_response", retryable=False)
    set_state({
        "access_token": str(access_token),
        "refresh_token": str(refresh_token),
        "access_token_expires_at": str(time.time() + int(expires_in)),
        "oauth_setup_expires_at": "0",
    })


def amo_configured() -> bool:
    required = (
        "AMOCRM_ACCOUNT_URL",
        "AMOCRM_CLIENT_ID",
        "AMOCRM_CLIENT_SECRET",
        "AMOCRM_REDIRECT_URI",
    )
    return all(os.environ.get(key, "").strip() for key in required) and bool(
        get_state("refresh_token") or os.environ.get("AMOCRM_REFRESH_TOKEN", "").strip()
    )


def amo_base_url() -> str:
    value = os.environ.get("AMOCRM_ACCOUNT_URL", "").strip().rstrip("/")
    parsed = urlsplit(value)
    allowed_suffixes = (".amocrm.ru", ".amocrm.com", ".kommo.com")
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or
            parsed.password or parsed.path not in ("", "/") or
            not parsed.hostname.lower().endswith(allowed_suffixes)):
        raise AmoCRMError("invalid_account_url", retryable=False)
    return value


def refresh_access_token() -> str:
    with token_lock:
        expires_at = float(get_state("access_token_expires_at") or "0")
        access_token = get_state("access_token")
        if access_token and expires_at > time.time() + 60:
            return access_token

        refresh_token = get_state("refresh_token") or os.environ.get("AMOCRM_REFRESH_TOKEN", "").strip()
        if not refresh_token:
            raise AmoCRMError("oauth_refresh_token_missing", retryable=False)

        body = json.dumps({
            "client_id": os.environ["AMOCRM_CLIENT_ID"],
            "client_secret": os.environ["AMOCRM_CLIENT_SECRET"],
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "redirect_uri": os.environ["AMOCRM_REDIRECT_URI"],
        }).encode("utf-8")
        request = Request(
            amo_base_url() + "/oauth2/access_token",
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=20) as response:
                tokens = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise AmoCRMError(
                "oauth_http_" + str(error.code),
                retryable=error.code == 429 or error.code >= 500,
            ) from None
        except (URLError, TimeoutError, json.JSONDecodeError):
            raise AmoCRMError("oauth_network_or_response_error") from None

        new_access = tokens.get("access_token")
        new_refresh = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in")
        if not new_access or not new_refresh or not isinstance(expires_in, (int, float)):
            raise AmoCRMError("oauth_invalid_token_response", retryable=False)
        set_state({
            "access_token": str(new_access),
            "refresh_token": str(new_refresh),
            "access_token_expires_at": str(time.time() + int(expires_in)),
        })
        return str(new_access)


def api_request(method: str, path: str, payload: Any) -> Any:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    for attempt in range(2):
        access_token = refresh_access_token()
        request = Request(
            amo_base_url() + path,
            data=body,
            headers={
                "Authorization": "Bearer " + access_token,
                "Content-Type": "application/json",
                "Accept": "application/hal+json, application/json",
            },
            method=method,
        )
        try:
            with urlopen(request, timeout=20) as response:
                raw = response.read()
                return json.loads(raw.decode("utf-8")) if raw else {}
        except HTTPError as error:
            if error.code == 401 and attempt == 0:
                set_state({"access_token_expires_at": "0"})
                continue
            raise AmoCRMError("api_http_" + str(error.code), retryable=error.code == 429 or error.code >= 500) from None
        except (URLError, TimeoutError, json.JSONDecodeError):
            raise AmoCRMError("api_network_or_response_error") from None
    raise AmoCRMError("api_unauthorized", retryable=False)


def configured_lead_fields(lead: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        mapping = json.loads(os.environ.get("AMOCRM_LEAD_FIELD_IDS_JSON", "{}"))
    except json.JSONDecodeError:
        raise AmoCRMError("invalid_lead_field_map", retryable=False) from None
    if not isinstance(mapping, dict):
        raise AmoCRMError("invalid_lead_field_map", retryable=False)

    fields = []
    for key, raw_id in mapping.items():
        value = lead["utm"].get(key) if key.lower().startswith("utm_") else lead.get(key)
        if value in (None, ""):
            continue
        try:
            field_id = int(raw_id)
        except (TypeError, ValueError):
            raise AmoCRMError("invalid_lead_field_id", retryable=False) from None
        fields.append({"field_id": field_id, "values": [{"value": str(value)}]})
    return fields[:40]


def amo_lead_name(lead: dict[str, Any]) -> str:
    title = lead["type"]
    person = lead["name"] or lead["phone"]
    return (title + " — " + person)[:250]


def canonical_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if len(digits) == 11 and digits.startswith("8"):
        return "7" + digits[1:]
    if len(digits) == 10:
        return "7" + digits
    return digits


def find_existing_contact_id(phone: str) -> int | None:
    wanted = canonical_phone(phone)
    if not wanted:
        return None
    response = api_request(
        "GET",
        "/api/v4/contacts?" + urlencode({"query": phone, "limit": 250}),
        None,
    )
    embedded = response.get("_embedded", {}) if isinstance(response, dict) else {}
    contacts = embedded.get("contacts", []) if isinstance(embedded, dict) else []
    for contact in contacts:
        if not isinstance(contact, dict) or not contact.get("id"):
            continue
        fields = contact.get("custom_fields_values") or []
        if not isinstance(fields, list):
            continue
        for field in fields:
            if not isinstance(field, dict) or field.get("field_code") != "PHONE":
                continue
            values = field.get("values") or []
            if isinstance(values, list) and any(
                isinstance(item, dict)
                and canonical_phone(str(item.get("value", ""))) == wanted
                for item in values
            ):
                return int(contact["id"])
    return None


def create_amo_lead(lead: dict[str, Any]) -> int:
    contact_id = find_existing_contact_id(lead["phone"])
    if contact_id:
        contact = {"id": contact_id, "is_main": True}
    else:
        contact = {
            "name": lead["name"] or lead["phone"],
            "custom_fields_values": [{
                "field_code": "PHONE",
                "values": [{"value": lead["phone"], "enum_code": "WORK"}],
            }],
        }
    lead_item: dict[str, Any] = {
        "name": amo_lead_name(lead),
        "request_id": lead["request_id"],
        "_embedded": {"contacts": [contact]},
    }
    field_values = configured_lead_fields(lead)
    if field_values:
        lead_item["custom_fields_values"] = field_values

    for env_key, api_key in (
        ("AMOCRM_PIPELINE_ID", "pipeline_id"),
        ("AMOCRM_STATUS_ID", "status_id"),
        ("AMOCRM_RESPONSIBLE_USER_ID", "responsible_user_id"),
    ):
        value = os.environ.get(env_key, "").strip()
        if value:
            try:
                lead_item[api_key] = int(value)
            except ValueError:
                raise AmoCRMError("invalid_" + env_key.lower(), retryable=False) from None

    response = api_request("POST", "/api/v4/leads/complex", [lead_item])
    created = response[0] if isinstance(response, list) and response else None
    if not isinstance(created, dict) or not created.get("id"):
        raise AmoCRMError("lead_create_invalid_response")
    return int(created["id"])


def lead_note(lead: dict[str, Any]) -> str:
    lines = [
        "Заявка с сайта KOLVIKA",
        "Лендинг: " + (lead["landing"] or "—"),
        "Тип обращения: " + lead["type"],
        "Имя: " + (lead["name"] or "—"),
        "Телефон: " + lead["phone"],
        "Сообщение: " + (lead["message"] or "—"),
        "Страница: " + (lead["page"] or "—"),
        "Referrer: " + (lead["referrer"] or "—"),
    ]
    if lead["utm"]:
        lines.append("UTM:")
        lines.extend(key + "=" + value for key, value in sorted(lead["utm"].items()))
    if lead["ym_client_id"]:
        lines.append("Яндекс ClientID: " + lead["ym_client_id"])
    return "\n".join(lines)[:8000]


def send_amo_note(lead_id: int, lead: dict[str, Any]) -> None:
    api_request(
        "POST",
        "/api/v4/leads/" + str(lead_id) + "/notes",
        [{"note_type": "common", "params": {"text": lead_note(lead)}}],
    )


def claim_next_lead() -> sqlite3.Row | None:
    now = time.time()
    with connect_db() as conn:
        row = conn.execute(
            "SELECT * FROM leads WHERE amo_status IN ('queued', 'retry') "
            "AND amo_next_attempt_at <= ? ORDER BY received_at LIMIT 1",
            (now,),
        ).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE leads SET amo_status = 'sending', amo_attempts = amo_attempts + 1 "
            "WHERE request_id = ?",
            (row["request_id"],),
        )
        return conn.execute(
            "SELECT * FROM leads WHERE request_id = ?", (row["request_id"],)
        ).fetchone()


def update_delivery(request_id: str, **values: Any) -> None:
    allowed = {"amo_status", "amo_next_attempt_at", "amo_lead_id", "amo_note_sent", "amo_last_error"}
    if not values or not set(values).issubset(allowed):
        raise ValueError("invalid delivery update")
    columns = ", ".join(key + " = ?" for key in values)
    with connect_db() as conn:
        conn.execute(
            "UPDATE leads SET " + columns + " WHERE request_id = ?",
            (*values.values(), request_id),
        )


def deliver_one(row: sqlite3.Row) -> None:
    lead = json.loads(row["payload_json"])
    lead_id = row["amo_lead_id"]
    try:
        with delivery_lock:
            if not amo_configured():
                update_delivery(
                    row["request_id"], amo_status="queued", amo_next_attempt_at=time.time() + 60,
                    amo_last_error="amoCRM_not_configured",
                )
                return
            if not lead_id:
                lead_id = create_amo_lead(lead)
                update_delivery(row["request_id"], amo_lead_id=lead_id, amo_last_error="")
            if not row["amo_note_sent"]:
                send_amo_note(lead_id, lead)
                update_delivery(row["request_id"], amo_note_sent=1)
            update_delivery(
                row["request_id"], amo_status="sent", amo_next_attempt_at=0, amo_last_error=""
            )
            logging.info("amoCRM delivery complete request_id=%s lead_id=%s", row["request_id"], lead_id)
    except AmoCRMError as error:
        attempts = int(row["amo_attempts"])
        retryable = error.retryable or attempts < 5
        if retryable:
            delay = min(30 * (2 ** min(max(attempts - 1, 0), 10)), 21600)
            next_status = "retry"
            next_time = time.time() + delay
        else:
            next_status = "failed"
            next_time = 0
        update_delivery(
            row["request_id"], amo_status=next_status, amo_next_attempt_at=next_time,
            amo_last_error=error.code[:120],
        )
        logging.warning(
            "amoCRM delivery %s request_id=%s error=%s",
            next_status, row["request_id"], error.code,
        )
    except Exception:
        attempts = int(row["amo_attempts"])
        delay = min(30 * (2 ** min(max(attempts - 1, 0), 10)), 21600)
        update_delivery(
            row["request_id"], amo_status="retry", amo_next_attempt_at=time.time() + delay,
            amo_last_error="internal_delivery_error",
        )
        logging.exception("amoCRM delivery retry request_id=%s", row["request_id"])


def worker_loop() -> None:
    while not stop_worker.is_set():
        try:
            row = claim_next_lead()
            if row:
                deliver_one(row)
                continue
        except Exception:
            logging.exception("lead delivery worker error")
        stop_worker.wait(3)


def queue_counts() -> dict[str, int]:
    with connect_db() as conn:
        rows = conn.execute(
            "SELECT amo_status, COUNT(*) AS count FROM leads GROUP BY amo_status"
        ).fetchall()
    return {row["amo_status"]: row["count"] for row in rows}


class LeadHandler(BaseHTTPRequestHandler):
    server_version = "KolvikaLeadService/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        # OAuth callbacks carry a short-lived authorization code in the query
        # string. Never write request paths or query values to application logs.
        logging.info("%s %s %s", self.address_string(), self.command, urlsplit(self.path).path)

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, status: int, title: str, message: str) -> None:
        body = (
            "<!doctype html><html lang=\"ru\"><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>" + title + "</title><main><h1>" + title + "</h1><p>" + message + "</p></main>"
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
        self.end_headers()
        self.wfile.write(body)

    def redirect_clean_callback(self, path: str) -> None:
        self.send_response(303)
        self.send_header("Location", path)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/api/amocrm/callback":
            self.handle_amocrm_callback(parse_qs(parsed.query, keep_blank_values=True))
            return
        if parsed.path == "/api/amocrm/oauth-complete":
            self.send_html(
                200,
                "amoCRM подключена",
                "OAuth-токены сохранены на сервере. Это окно можно закрыть.",
            )
            return
        if parsed.path != "/healthz":
            self.send_json(404, {"ok": False, "error": "not_found"})
            return
        try:
            self.send_json(200, {
                "ok": True,
                "service": "kolvika-leads",
                "amocrm_configured": amo_configured(),
                "queue": queue_counts(),
            })
        except sqlite3.Error:
            self.send_json(503, {"ok": False, "error": "storage_unavailable"})

    def handle_amocrm_callback(self, query: dict[str, list[str]]) -> None:
        if query.get("error"):
            self.send_html(400, "Доступ не предоставлен", "Авторизация интеграции была отменена.")
            return
        state = (query.get("state") or [""])[0]
        code = (query.get("code") or [""])[0]
        if not state or not code or not consume_oauth_state(state):
            self.send_html(
                400,
                "Ссылка авторизации недействительна",
                "Создайте новую ссылку авторизации из консоли сервера и повторите подключение.",
            )
            return
        try:
            exchange_authorization_code(code)
        except AmoCRMError as error:
            logging.warning("amoCRM OAuth callback failed error=%s", error.code)
            self.send_html(
                502,
                "Не удалось завершить подключение",
                "Создайте новую ссылку авторизации и повторите подключение.",
            )
            return
        self.redirect_clean_callback("/api/amocrm/oauth-complete")

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/leads":
            self.send_json(404, {"ok": False, "error": "not_found"})
            return
        if not request_origin_allowed(self):
            self.send_json(403, {"ok": False, "error": "origin_not_allowed"})
            return
        if rate_limited(self):
            self.send_json(429, {"ok": False, "error": "rate_limited"})
            return
        if not (self.headers.get("Content-Type") or "").lower().startswith("application/json"):
            self.send_json(415, {"ok": False, "error": "json_required"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_SIZE:
            self.send_json(413, {"ok": False, "error": "invalid_body_size"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            lead = normalize_lead(payload)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"ok": False, "error": "invalid_json"})
            return
        except LeadInputError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
            return

        try:
            saved, duplicate = store_lead(lead)
        except sqlite3.Error:
            logging.exception("lead storage failed request_id=%s", lead["request_id"])
            self.send_json(503, {"ok": False, "error": "storage_unavailable"})
            return
        if not saved:
            self.send_json(409, {"ok": False, "error": "request_id_conflict"})
            return
        self.send_json(200 if duplicate else 202, {
            "ok": True,
            "saved": True,
            "request_id": lead["request_id"],
            "amo_status": "queued",
            "duplicate": duplicate,
        })


def main() -> None:
    os.umask(0o077)
    if len(sys.argv) > 1:
        if sys.argv[1:] == ["oauth-link"]:
            if not db_path().exists():
                init_db()
            print(create_oauth_authorization_url())
            return
        if sys.argv[1:] == ["oauth-code"]:
            if not db_path().exists():
                init_db()
            code = os.environ.get("AMOCRM_AUTH_CODE", "").strip()
            if not code:
                raise SystemExit("AMOCRM_AUTH_CODE is required")
            exchange_authorization_code(code)
            print("OAuth authorization code exchanged; tokens stored in SQLite.")
            return
        raise SystemExit("Usage: lead_service.py [oauth-link|oauth-code]")
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    init_db()
    worker = threading.Thread(target=worker_loop, name="amoCRM-delivery", daemon=True)
    worker.start()

    bind = os.environ.get("LEADS_BIND", "127.0.0.1")
    port = int(os.environ.get("LEADS_PORT", str(DEFAULT_PORT)))
    server = ThreadingHTTPServer((bind, port), LeadHandler)
    server.daemon_threads = True
    logging.info(
        "lead service listening on %s:%s; amoCRM configured=%s",
        bind, port, amo_configured(),
    )

    def handle_shutdown(_signum: int, _frame: Any) -> None:
        stop_worker.set()
        server.shutdown()

    serve_thread = threading.Thread(target=server.serve_forever, name="lead-service-http", daemon=True)
    serve_thread.start()
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)
    try:
        serve_thread.join()
    finally:
        stop_worker.set()
        server.server_close()


if __name__ == "__main__":
    main()
