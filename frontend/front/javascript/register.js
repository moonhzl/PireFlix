const registerForm = document.getElementById("registerForm");

const message = document.getElementById("message");

const registerButton =
    document.getElementById("registerButton");

const password =
    document.getElementById("password");

const confirmPassword =
    document.getElementById("confirmPassword");

const togglePassword =
    document.getElementById("togglePassword");

const toggleConfirmPassword =
    document.getElementById("toggleConfirmPassword");


// =========================================
// MOSTRAR / ESCONDER SENHA
// =========================================

togglePassword.addEventListener("click", () => {

    if (password.type === "password") {

        password.type = "text";

        togglePassword.textContent = "Ocultar";

    } else {

        password.type = "password";

        togglePassword.textContent = "Mostrar";
    }

});


toggleConfirmPassword.addEventListener("click", () => {

    if (confirmPassword.type === "password") {

        confirmPassword.type = "text";

        toggleConfirmPassword.textContent = "Ocultar";

    } else {

        confirmPassword.type = "password";

        toggleConfirmPassword.textContent = "Mostrar";
    }

});


// =========================================
// REGISTER
// =========================================

registerForm.addEventListener("submit", async (event) => {

    event.preventDefault();


    const name =
        document.getElementById("name").value.trim();

    const email =
        document.getElementById("email").value.trim();

    const passwordValue =
        password.value;

    const confirmPasswordValue =
        confirmPassword.value;


    clearMessage();


    // Nome

    if (name.length < 2) {

        showMessage(
            "Digite um nome válido.",
            "error"
        );

        return;
    }


    // Email

    if (!isValidEmail(email)) {

        showMessage(
            "Digite um e-mail válido.",
            "error"
        );

        return;
    }


    // Senha

    if (passwordValue.length < 6) {

        showMessage(
            "A senha precisa ter pelo menos 6 caracteres.",
            "error"
        );

        return;
    }


    // Confirmar senha

    if (passwordValue !== confirmPasswordValue) {

        showMessage(
            "As senhas não são iguais.",
            "error"
        );

        return;
    }


    // Loading

    registerButton.disabled = true;

    registerButton.classList.add("loading");


    try {

        const response = await fetch(luneflixApiUrl("/api/register"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ name, email, password: passwordValue })
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Não foi possível criar a conta.");
        }


        showMessage("Conta criada com sucesso! Redirecionando...", "success");
        registerForm.reset();
        const nextPage = new URLSearchParams(location.search).get("next");
        setTimeout(() => { window.location.href = nextPage && nextPage.startsWith("payment.html") ? `login.html?next=${encodeURIComponent(nextPage)}` : "login.html"; }, 1000);


    } catch (error) {

        console.error(error);

        showMessage(error.message || "Ocorreu um erro ao criar sua conta.", "error");

    } finally {

        registerButton.disabled = false;

        registerButton.classList.remove("loading");
    }

});


// =========================================
// VALIDAÇÃO DE EMAIL
// =========================================

function isValidEmail(email) {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

}


// =========================================
// MENSAGEM
// =========================================

function showMessage(text, type) {

    message.textContent = text;

    message.className =
        `message ${type}`;
}


function clearMessage() {

    message.textContent = "";

    message.className = "message";
}
