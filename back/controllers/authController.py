import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models.user import authenticate_user, create_password_reset, get_user, initialize_database, reset_password, update_profile


def handle_request(request):
	initialize_database()
	action = request.get("action")

	if action == "login":
		user = authenticate_user(request["email"], request["password"], request.get("ip"))
		if user is None:
			return {"ok": False, "error": "E-mail ou senha inválidos."}
		return {"ok": True, "user": user}

	if action == "profile":
		user = get_user(request["user_id"])
		return {"ok": bool(user), "user": user, "error": None if user else "Usuário não encontrado."}

	if action == "update_profile":
		return {"ok": True, "user": update_profile(request["user_id"], request.get("name"), request.get("avatar"))}

	if action == "forgot_password":
		token = create_password_reset(request.get("email"))
		return {"ok": True, "token": token}

	if action == "reset_password":
		reset_password(request.get("token"), request.get("password"))
		return {"ok": True}

	return {"ok": False, "error": "Operação inválida."}


if __name__ == "__main__":
	try:
		print(json.dumps(handle_request(json.loads(sys.stdin.read())), ensure_ascii=False))
	except (KeyError, ValueError, RuntimeError) as error:
		print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
		sys.exit(1)
