import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models.supabase_client import delete, insert, next_id, select, update
from models.user import _hash_password, authenticate_user


def now():
	return datetime.now(timezone.utc).isoformat()


def initialize_admin_database():
	return None


def log_action(admin_id, action, description, affected_user_id=None, ip=None):
	insert("admin_logs", {"id": next_id("admin_logs"), "action": action, "admin_id": admin_id, "affected_user_id": affected_user_id, "description": description, "ip": ip, "created_at": now()})


def admin_login(request):
	user = authenticate_user(request.get("email", ""), request.get("password", ""))
	if not user or user.get("role") not in ("admin", "manager"):
		return {"ok": False, "error": "Acesso administrativo negado."}
	log_action(user["id"], "admin_login", "Login administrativo realizado", ip=request.get("ip"))
	return {"ok": True, "admin": user}


def rows(table, filters=None, order=None, limit=None):
	return select(table, filters or {}, order, limit)


def dashboard():
	users = rows("users")
	payments = rows("payments")
	movies = rows("movies")
	coupons = rows("coupons")
	approved = [item for item in payments if item.get("status") == "approved"]
	recent_users = [{key: user.get(key) for key in ("id", "name", "email", "role", "status", "plan", "created_at", "last_login")} for user in sorted(users, key=lambda item: item.get("id", 0), reverse=True)[:6]]
	recent_payments = sorted(payments, key=lambda item: item.get("id", 0), reverse=True)[:6]
	for payment in recent_payments:
		user = next((item for item in users if item.get("id") == payment.get("user_id")), None)
		payment["user_name"] = user.get("name") if user else None
	logs = sorted(rows("admin_logs"), key=lambda item: item.get("id", 0), reverse=True)[:6]
	return {"metrics": {"users": len(users), "active_users": len([u for u in users if u.get("status") == "active"]), "new_users": len(users), "payments": len(approved), "revenue": sum(float(p.get("amount") or 0) for p in approved), "pending": len([p for p in payments if p.get("status") == "pending"]), "movies": len([m for m in movies if m.get("status") == "active"]), "coupons": len([c for c in coupons if c.get("status") == "active"])}, "recent_users": recent_users, "recent_payments": recent_payments, "logs": logs}


def users(request):
	result = rows("users", order="id.desc")
	term = str(request.get("search") or "").lower()
	if term: result = [u for u in result if term in f"{u.get('name', '')} {u.get('email', '')} {u.get('id', '')}".lower()]
	if request.get("status") in ("active", "blocked", "inactive"): result = [u for u in result if u.get("status") == request["status"]]
	return [{key: user.get(key) for key in ("id", "name", "email", "role", "status", "plan", "created_at", "last_login")} for user in result]


def update_user(request):
	user_id = int(request["id"])
	values = {key: request[key] for key in ("status", "plan", "role") if request.get(key) is not None}
	if values.get("status") not in (None, "active", "blocked", "inactive"): raise ValueError("Status inválido.")
	if values.get("plan") not in (None, "free", "basic", "premium", "family"): raise ValueError("Plano inválido.")
	if values.get("role") not in (None, "user", "manager", "admin"): raise ValueError("Cargo inválido.")
	update("users", {"id": f"eq.{user_id}"}, values)
	log_action(request["admin_id"], "user_updated", "Usuário atualizado", user_id, request.get("ip"))
	return {"ok": True}


def reset_password(request):
	password = request.get("password", "")
	if len(password) < 6: raise ValueError("A nova senha precisa ter pelo menos 6 caracteres.")
	salt, password_hash = _hash_password(password)
	update("users", {"id": f"eq.{int(request['id'])}"}, {"password_hash": password_hash, "password_salt": salt})
	log_action(request["admin_id"], "password_reset", "Senha resetada pelo administrador", int(request["id"]), request.get("ip"))
	return {"ok": True}


def delete_user(request):
	user_id = int(request["id"])
	if user_id == int(request["admin_id"]): raise ValueError("Você não pode excluir a própria conta administrativa.")
	delete("users", {"id": f"eq.{user_id}"})
	log_action(request["admin_id"], "user_deleted", "Usuário excluído", user_id, request.get("ip"))
	return {"ok": True}


def create_movie(request):
	movie = {"id": next_id("movies"), "created_at": now()}
	movie.update({key: request.get(key) for key in ("title", "description", "genre", "category", "year", "duration", "rating", "poster_url", "banner_url", "video_url")})
	movie["featured"] = bool(request.get("featured")); movie["status"] = "active"
	insert("movies", movie); log_action(request["admin_id"], "movie_created", f"Filme {movie['title']} criado", ip=request.get("ip"))
	return {"ok": True, "id": movie["id"]}


def create_coupon(request):
	coupon = {"id": next_id("coupons"), "code": request["code"].upper(), "discount_type": request.get("discount_type", "percent"), "discount_value": float(request["discount_value"]), "expires_at": request.get("expires_at") or None, "usage_limit": request.get("usage_limit") or None, "usage_count": 0, "status": "active", "created_at": now()}
	insert("coupons", coupon); log_action(request["admin_id"], "coupon_created", f"Cupom {coupon['code']} criado", ip=request.get("ip"))
	return {"ok": True, "id": coupon["id"]}


def finance(request):
	users_by_id = {user.get("id"): user for user in rows("users")}
	payments = rows("payments", order="created_at.desc")
	term = str(request.get("search") or "").lower().strip()
	status = str(request.get("status") or "").lower().strip()
	plan = str(request.get("plan") or "").lower().strip()

	def enriched(payment):
		item = dict(payment)
		user = users_by_id.get(item.get("user_id"), {})
		item["user_name"] = user.get("name") or "Usuário removido"
		item["user_email"] = user.get("email") or ""
		return item

	items = [enriched(payment) for payment in payments]
	if term:
		items = [item for item in items if term in f"{item.get('transaction_id', '')} {item.get('user_name', '')} {item.get('user_email', '')}".lower()]
	if status:
		items = [item for item in items if str(item.get("status") or "").lower() == status]
	if plan:
		items = [item for item in items if str(item.get("plan") or "").lower() == plan]

	approved = [item for item in payments if item.get("status") == "approved"]
	pending = [item for item in payments if item.get("status") == "pending"]
	cancelled = [item for item in payments if item.get("status") in ("cancelled", "refunded", "failed")]
	months = {}
	for item in approved:
		month = str(item.get("created_at") or "")[:7]
		if month: months[month] = months.get(month, 0) + float(item.get("amount") or 0)
	series = [{"month": month, "amount": amount} for month, amount in sorted(months.items())[-6:]]
	return {"ok": True, "data": {
		"metrics": {
			"revenue": sum(float(item.get("amount") or 0) for item in approved),
			"approved_count": len(approved),
			"pending_value": sum(float(item.get("amount") or 0) for item in pending),
			"pending_count": len(pending),
			"cancelled_count": len(cancelled),
			"total_count": len(payments)
		},
		"payments": items,
		"series": series,
		"plans": sorted({str(item.get("plan")) for item in payments if item.get("plan")})
	}}


def dispatch(request):
	action = request.get("action")
	if action == "login": return admin_login(request)
	if action == "dashboard": return {"ok": True, "data": dashboard()}
	if action == "users": return {"ok": True, "data": users(request)}
	if action == "finance": return finance(request)
	if action == "update_user": return update_user(request)
	if action == "reset_password": return reset_password(request)
	if action == "delete_user": return delete_user(request)
	if action in ("payments", "movies", "coupons"): return {"ok": True, "data": rows(action)}
	if action == "create_movie": return create_movie(request)
	if action == "create_coupon": return create_coupon(request)
	if action == "modules": return {"ok": True, "data": rows("modules", order="name")}
	if action == "settings": return {"ok": True, "data": {item["key"]: item["value"] for item in rows("settings")}}
	if action == "update_settings":
		for key, value in request.get("settings", {}).items():
			if key in ("app_name", "support_url", "discord_url"): update("settings", {"key": f"eq.{key}"}, {"value": str(value)})
		return {"ok": True}
	if action == "toggle_module":
		status = "inactive" if request.get("status") == "active" else "active"; update("modules", {"key": f"eq.{request['key']}"}, {"status": status, "updated_at": now()}); return {"ok": True, "status": status}
	if action == "logs": return {"ok": True, "data": rows("admin_logs", order="id.desc", limit=100)}
	return {"ok": False, "error": "Operação administrativa inválida."}


if __name__ == "__main__":
	try: print(json.dumps(dispatch(json.loads(sys.stdin.read())), ensure_ascii=False))
	except (KeyError, ValueError, TypeError) as error:
		print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False)); sys.exit(1)
