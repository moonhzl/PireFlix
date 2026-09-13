import hashlib
import secrets
from datetime import datetime, timezone

from models.supabase_client import delete, insert, next_id, select, update


def initialize_database():
	return None


def _hash_password(password, salt=None):
	salt = salt or secrets.token_bytes(16)
	password_hash = hashlib.pbkdf2_hmac(
		"sha256", password.encode("utf-8"), salt, 120000
	)
	return salt.hex(), password_hash.hex()


def authenticate_user(email, password, ip=None):
	identifier = email.strip().lower()
	rows = select("users", {"email": f"eq.{identifier}"}, limit=1)
	if not rows:
		rows = select("users", {"username": f"eq.{identifier}"}, limit=1)
	user = rows[0] if rows else None

	if user is None:
		return None

	_, password_hash = _hash_password(password, bytes.fromhex(user["password_salt"]))
	if not secrets.compare_digest(password_hash, user["password_hash"]):
		return None

	if user["status"] != "active":
		return None

	if ip and user.get("last_ip") and user["last_ip"] != ip:
		insert("security_logs", {"id": next_id("security_logs"), "type": "LOGIN_DIFFERENT_IP", "user_id": user["id"], "timestamp": datetime.now(timezone.utc).isoformat(), "ip": ip, "details": "Novo IP detectado durante login"})
	update("users", {"id": f"eq.{user['id']}"}, {"last_login": datetime.now(timezone.utc).isoformat(), "last_ip": ip})

	return {
		"id": user["id"],
		"name": user["name"],
		"email": user["email"],
		"role": user["role"],
		"status": user["status"],
		"plan": user["plan"],
		"avatar": user.get("avatar"),
		"subscription_status": user.get("subscription_status"),
		"subscription_expires_at": user.get("subscription_expires_at"),
	}


def get_user(user_id):
	rows = select("users", {"id": f"eq.{user_id}"}, limit=1)
	return rows[0] if rows else None


def update_profile(user_id, name, avatar):
	name = str(name or "").strip()
	avatar = str(avatar or "").strip() or None
	if len(name) < 2 or len(name) > 80:
		raise ValueError("O nome precisa ter entre 2 e 80 caracteres.")
	if not get_user(user_id):
		raise ValueError("Usuário não encontrado.")
	update("users", {"id": f"eq.{user_id}"}, {"name": name, "avatar": avatar})
	return get_user(user_id)


def create_password_reset(email):
	rows = select("users", {"email": f"eq.{str(email or '').strip().lower()}"}, limit=1)
	user = rows[0] if rows else None
	if not user:
		return None
	token = secrets.token_urlsafe(32)
	expires = datetime.now(timezone.utc).timestamp() + 30 * 60
	expires_at = datetime.fromtimestamp(expires, timezone.utc).isoformat()
	delete("password_reset_tokens", {"user_id": f"eq.{user['id']}"})
	insert("password_reset_tokens", {"token_hash": hashlib.sha256(token.encode()).hexdigest(), "user_id": user["id"], "expires_at": expires_at})
	return token


def reset_password(token, password):
	if len(str(password or "")) < 6:
		raise ValueError("A senha precisa ter pelo menos 6 caracteres.")
	token_hash = hashlib.sha256(str(token or "").encode()).hexdigest()
	rows = select("password_reset_tokens", {"token_hash": f"eq.{token_hash}", "used": "eq.false", "expires_at": f"gt.{datetime.now(timezone.utc).isoformat()}"}, limit=1)
	if not rows: raise ValueError("Token inválido ou expirado.")
	row = rows[0]
	salt, password_hash = _hash_password(password)
	update("users", {"id": f"eq.{row['user_id']}"}, {"password_hash": password_hash, "password_salt": salt})
	update("password_reset_tokens", {"token_hash": f"eq.{token_hash}"}, {"used": True})
