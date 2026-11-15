"""Optionele eigen Python gateway voor iCloud-notities. NIET onderdeel van FTP-publicatie.
Installeer op een privéserver: pip install flask pyicloud
Publiceer uitsluitend achter HTTPS, authenticatie en reverse proxy; niet direct openzetten.
Dit voorbeeld is bedoeld voor één gebruiker en een lokale ontwikkelomgeving.
"""
from flask import Flask, request, jsonify
from pyicloud import PyiCloudService
import os
app=Flask(__name__)
icloud=None
@app.after_request
def headers(r):
    r.headers["Cache-Control"]="no-store"
    r.headers["X-Content-Type-Options"]="nosniff"
    return r
def reject_if_remote():
    # NIET voldoende voor publieke deployment. Reverse proxy moet eigen authenticatie afdwingen.
    if request.remote_addr not in ("127.0.0.1","::1"):
        return jsonify(error="Gateway staat alleen lokaal open"),403
    return None
@app.before_request
def guard():
    return reject_if_remote()
@app.get("/api/status")
def status():
    return jsonify(configured=True,authenticated=bool(icloud and icloud.is_trusted_session))
@app.post("/api/login")
def login():
    global icloud
    data=request.get_json(silent=True) or {}
    if not data.get("username") or not data.get("password"):return jsonify(error="Gebruikersnaam en wachtwoord vereist"),400
    try:
        icloud=PyiCloudService(data["username"],data["password"])
        return jsonify(requires_2fa=bool(icloud.requires_2fa),authenticated=not icloud.requires_2fa)
    except Exception:
        return jsonify(error="Apple-aanmelding geweigerd"),401
@app.post("/api/verify")
def verify():
    if not icloud:return jsonify(error="Eerst aanmelden"),401
    code=(request.get_json(silent=True) or {}).get("code","")
    try:
        valid=icloud.validate_2fa_code(code)
        if valid and not icloud.is_trusted_session:icloud.trust_session()
        return jsonify(authenticated=bool(valid),requires_2fa=not bool(valid))
    except Exception:return jsonify(error="Verificatie mislukt"),401
def ensure():
    if not icloud:return jsonify(error="Niet aangemeld"),401
    return None
@app.get("/api/folders")
def folders():
    if (e:=ensure()):return e
    try:return jsonify(folders=[{"id":x.id,"name":x.name} for x in icloud.notes.folders()])
    except Exception:return jsonify(error="Mappen ophalen mislukt"),502
@app.get("/api/notes")
def notes():
    if (e:=ensure()):return e
    try:return jsonify(notes=[{"id":x.id,"title":x.title,"modified_at":str(x.modified_at or ""),"folder_id":str(getattr(x,"folder_id","") or "")} for x in icloud.notes.iter_all()])
    except Exception:return jsonify(error="Notities ophalen mislukt"),502
@app.get("/api/notes/<path:note_id>")
def note(note_id):
    if (e:=ensure()):return e
    try:
        n=icloud.notes.get(note_id)
        return jsonify(id=n.id,title=n.title,text=n.text,modified_at=str(getattr(n,"modified_at","") or ""))
    except Exception:return jsonify(error="Notitie niet beschikbaar"),404
if __name__=="__main__":app.run(host="127.0.0.1",port=7866,debug=False)
