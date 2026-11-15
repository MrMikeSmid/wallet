"""Persoonlijke, alleen-lezen iCloud Notes gateway (Flask + PyiCloud).
Requires Python 3.11+, HTTPS reverse proxy, environment variables
NOTES_ACCESS_KEY (long random secret) and NOTES_SESSION_KEY (long random secret).
Single-user process. Do not expose without HTTPS or owner authentication.
"""
import os
import hmac
import secrets
import time
import threading
from datetime import datetime
from flask import Flask, jsonify, request, session
from pyicloud import PyiCloudService

if not os.getenv("NOTES_ACCESS_KEY") or not os.getenv("NOTES_SESSION_KEY"):
    raise RuntimeError("Configureer NOTES_ACCESS_KEY en NOTES_SESSION_KEY voor opstarten")
if len(os.environ["NOTES_ACCESS_KEY"]) < 24 or len(os.environ["NOTES_SESSION_KEY"]) < 32:
    raise RuntimeError("Gebruik sterke willekeurige geheime sleutels")

app = Flask(__name__)
app.secret_key = os.environ["NOTES_SESSION_KEY"]
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_PATH="/wallet",
    MAX_CONTENT_LENGTH=8192,
    PERMANENT_SESSION_LIFETIME=3600,
)
clients = {}
attempts = {}
lock = threading.Lock()

def output_error(message, code):
    return jsonify(error=message), code

def limited(address):
    now = time.monotonic()
    with lock:
        existing = [x for x in attempts.get(address, []) if now-x < 300]
        existing.append(now)
        attempts[address] = existing
        return len(existing) > 12

@app.before_request
def protect():
    if request.path == "/api/health":
        return None
    if request.method != "GET":
        origin = request.headers.get("Origin", "")
        expected = os.environ.get("NOTES_PUBLIC_ORIGIN", "")
        if not expected or not hmac.compare_digest(origin, expected):
            return output_error("Ongeldige herkomst. Controleer HTTPS configuratie.", 403)
        if request.mimetype != "application/json":
            return output_error("JSON vereist", 415)
    if request.path != "/api/unlock" and not session.get("owner"):
        return output_error("Ontgrendel de app eerst", 401)

@app.after_request
def secure_headers(resp):
    resp.headers["Cache-Control"] = "no-store, private"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    return resp

def current():
    sid = session.get("sid")
    if not sid:
        return None
    with lock:
        return clients.get(sid)

def date_value(value):
    return value.isoformat() if isinstance(value, datetime) else str(value or "")

@app.get("/api/health")
def health():
    return jsonify(ready=True, service="icloud-notes-gateway")

@app.post("/api/unlock")
def unlock():
    if limited(request.remote_addr or "unknown"):
        return output_error("Te veel pogingen. Probeer later opnieuw.", 429)
    key = (request.get_json(silent=True) or {}).get("access_key", "")
    if not isinstance(key, str) or not hmac.compare_digest(key, os.environ["NOTES_ACCESS_KEY"]):
        return output_error("Onjuiste toegangscode", 401)
    session.clear()
    session["owner"] = True
    session.permanent = True
    return jsonify(ok=True)

@app.get("/api/status")
def status():
    api = current()
    return jsonify(configured=True, authenticated=bool(api and api.is_trusted_session))

@app.post("/api/login")
def login():
    if limited(request.remote_addr or "unknown"):
        return output_error("Te veel pogingen. Probeer later opnieuw.", 429)
    body = request.get_json(silent=True) or {}
    username, password = body.get("username"), body.get("password")
    if not isinstance(username, str) or not isinstance(password, str) or not username or not password:
        return output_error("Apple-account en wachtwoord vereist", 400)
    try:
        api = PyiCloudService(username, password, refresh_interval=None)
        sid = secrets.token_urlsafe(32)
        with lock:
            old = session.get("sid")
            if old:
                clients.pop(old, None)
            clients[sid] = api
        session["sid"] = sid
        if api.requires_2fa:
            api.request_2fa_code()
            return jsonify(requires_2fa=True)
        if api.requires_2sa:
            return output_error("Dit Apple-account gebruikt oudere tweestapsverificatie; niet ondersteund.", 422)
        return jsonify(authenticated=True)
    except Exception:
        return output_error("Apple-aanmelding mislukt. Controleer je gegevens of Apple-verificatie.", 401)

@app.post("/api/verify")
def verify():
    api = current()
    if api is None:
        return output_error("Meld je eerst aan", 401)
    if limited(request.remote_addr or "unknown"):
        return output_error("Te veel pogingen", 429)
    code = (request.get_json(silent=True) or {}).get("code", "")
    if not isinstance(code, str) or not (4 <= len(code) <= 12):
        return output_error("Ongeldige verificatiecode", 400)
    try:
        valid = api.validate_2fa_code(code)
        if valid and not api.is_trusted_session:
            api.trust_session()
        if not valid:
            return output_error("Apple heeft de verificatiecode afgewezen", 401)
        return jsonify(authenticated=True)
    except Exception:
        return output_error("Verificatie mislukt", 401)

def verified():
    api = current()
    if api is None or not api.is_trusted_session:
        return None
    return api

@app.get("/api/folders")
def folders():
    api = verified()
    if api is None: return output_error("Niet verbonden met Apple", 401)
    try:
        return jsonify(folders=[{"id": str(f.id), "name": f.name or "Naamloze map"} for f in api.notes.folders()])
    except Exception:
        return output_error("Kon mappen niet ophalen", 502)

@app.get("/api/notes")
def notes():
    api = verified()
    if api is None: return output_error("Niet verbonden met Apple", 401)
    try:
        rows = []
        for n in api.notes.iter_all():
            if not n.is_deleted:
                rows.append({"id": str(n.id), "title": n.title or "Naamloze notitie",
                    "modified_at": date_value(n.modified_at), "folder_id": str(n.folder_id or "")})
        return jsonify(notes=rows)
    except Exception:
        return output_error("Kon notities niet ophalen", 502)

@app.get("/api/notes/<note_id>")
def note(note_id):
    api = verified()
    if api is None: return output_error("Niet verbonden met Apple", 401)
    if len(note_id) > 256: return output_error("Ongeldig notitie-ID", 400)
    try:
        n = api.notes.get(note_id)
        return jsonify(id=str(n.id), title=n.title or "Naamloze notitie",
            modified_at=date_value(n.modified_at), text=n.text or "")
    except Exception:
        return output_error("Kon de notitie niet openen. Vergrendelde notities worden niet ondersteund.", 404)

@app.post("/api/logout")
def logout():
    with lock:
        clients.pop(session.get("sid"), None)
    session.clear()
    return jsonify(ok=True)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("NOTES_PORT", "7866")), debug=False)
