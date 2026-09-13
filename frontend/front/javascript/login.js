const loginForm = document.getElementById("loginForm");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const togglePassword = document.getElementById("togglePassword");

const loginButton = document.getElementById("loginButton");
const nextPage = new URLSearchParams(location.search).get("next");
if (nextPage && nextPage.startsWith("payment.html")) document.getElementById("registerLink").href = `../../index.html#plans`;


// ============================
// MOSTRAR / OCULTAR SENHA
// ============================

togglePassword.addEventListener("click", () => {

    const isPassword =
        passwordInput.type === "password";

    passwordInput.type =
        isPassword ? "text" : "password";

    togglePassword.textContent =
        isPassword ? "Ocultar" : "Mostrar";
});


// ============================
// LOGIN
// ============================

loginForm.addEventListener("submit", async (event) => {

    event.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        return;
    }

    // Ativa animação
    loginButton.classList.add("loading");
    loginButton.disabled = true;

    try {
        const response = await fetch(luneflixApiUrl("/api/login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "E-mail ou senha inválidos.");
        }

        localStorage.setItem("luneflixUser", JSON.stringify(data.user));
        window.location.href = nextPage && nextPage.startsWith("payment.html") ? nextPage : "home.html";
    } catch (error) {
        alert(error.message);
        loginButton.classList.remove("loading");
        loginButton.disabled = false;
    }
});


// ============================
// ESQUECI MINHA SENHA
// ============================

document
    .getElementById("forgotPassword")
    .addEventListener("click", (event) => {

        event.preventDefault();

        const email = window.prompt("Digite o e-mail da sua conta:");
        if (!email) return;
        fetch(luneflixApiUrl("/api/forgot-password"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) })
            .then(response => response.json().then(data => ({ response, data })))
            .then(({ response, data }) => alert(response.ok ? "Se o e-mail existir, as instruções foram geradas. Em desenvolvimento, o token aparece no terminal do servidor." : (data.error || "Não foi possível solicitar a recuperação.")))
            .catch(() => alert("Não foi possível solicitar a recuperação."));
    });


// ============================
// GOOGLE
// ============================

document
    .querySelector(".social-login")
    .addEventListener("click", () => {

        console.log(
            "Iniciar autenticação com Google"
        );

    });
