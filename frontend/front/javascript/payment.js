const requestedPlan = new URLSearchParams(location.search).get("plan") || "basic";
const selectedPlan = requestedPlan === "family" ? "standard" : requestedPlan;
const planNames = { basic: "Básico", standard: "Padrão", premium: "Premium" };
const planPrices = { basic: "R$ 5,90", standard: "R$ 12,90", premium: "R$ 24,90" };
let transactionId = sessionStorage.getItem("luneflix_pending_payment") || "";
let statusTimer;
const message = document.getElementById("message");

document.getElementById("planName").textContent = planNames[selectedPlan] || "Plano inválido";
document.getElementById("planPrice").textContent = planPrices[selectedPlan] || "—";

async function request(path, options = {}) {
    const response = await fetch(luneflixApiUrl(path), { credentials: "include", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir o pagamento.");
    return data;
}
function showMessage(text, type = "error") { message.textContent = text; message.className = `message ${type}`; }
function clean(value) { return String(value || "").replace(/\D/g, ""); }
function formatCpf(value) { const digits = clean(value).slice(0, 11); return digits.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); }
function formatPhone(value) { const digits = clean(value).slice(0, 11); return digits.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2"); }
function formatCep(value) { const digits = clean(value).slice(0, 8); return digits.replace(/(\d{5})(\d)/, "$1-$2"); }
function setMask(id, formatter) { document.getElementById(id).addEventListener("input", event => { event.target.value = formatter(event.target.value); }); }
function statusText(status) { return ({ pending: "Aguardando pagamento…", approved: "Pagamento confirmado.", expired: "Esta cobrança expirou.", cancelled: "Esta cobrança foi cancelada.", failed: "Não foi possível gerar esta cobrança." })[status] || "Aguardando pagamento…"; }

async function fillAddress() {
    const cep = clean(document.getElementById("cep").value);
    if (cep.length !== 8) return;
    try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();
        if (data.erro) return showMessage("CEP não encontrado.");
        document.getElementById("street").value = data.logradouro || "";
        document.getElementById("neighborhood").value = data.bairro || "";
        document.getElementById("city").value = data.localidade || "";
        document.getElementById("state").value = data.uf || "";
        document.getElementById("number").focus();
    } catch { showMessage("Não foi possível consultar o CEP. Preencha o endereço manualmente."); }
}
function openPix(payment) {
    document.getElementById("checkoutCard").classList.add("hidden");
    document.getElementById("successCard").classList.add("hidden");
    document.getElementById("pixCard").classList.remove("hidden");
    document.getElementById("pixPlan").textContent = planNames[payment.plan] || payment.plan;
    document.getElementById("pixAmount").textContent = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(payment.amount);
    document.getElementById("qrcode").src = payment.qrcode;
    document.getElementById("copyPaste").textContent = payment.copyPaste;
}
function showApproved() {
    clearInterval(statusTimer);
    sessionStorage.removeItem("luneflix_pending_payment");
    document.getElementById("pixCard").classList.add("hidden");
    document.getElementById("successCard").classList.remove("hidden");
    setTimeout(() => { location.href = "login.html"; }, 4000);
}
async function checkStatus() {
    if (!transactionId) return;
    try {
        const { payment } = await request(`/api/payment/${encodeURIComponent(transactionId)}/status`);
        if (payment.status === "approved") return showApproved();
        const status = document.getElementById("paymentStatus");
        status.className = `payment-status${["expired", "cancelled", "failed"].includes(payment.status) ? " failed" : ""}`;
        status.innerHTML = `<i></i>${statusText(payment.status)}`;
        if (["expired", "cancelled", "failed"].includes(payment.status)) { clearInterval(statusTimer); sessionStorage.removeItem("luneflix_pending_payment"); }
        return payment;
    } catch (error) { clearInterval(statusTimer); showMessage(error.message); }
}
function formPayload() {
    return {
        plan: selectedPlan, name: document.getElementById("name").value.trim(), email: document.getElementById("email").value.trim(), username: document.getElementById("username").value.trim(),
        password: document.getElementById("password").value, confirmPassword: document.getElementById("confirmPassword").value,
        cpf: document.getElementById("cpf").value, phone: document.getElementById("phone").value, cep: document.getElementById("cep").value,
        street: document.getElementById("street").value.trim(), number: document.getElementById("number").value.trim(), complement: document.getElementById("complement").value.trim(),
        neighborhood: document.getElementById("neighborhood").value.trim(), city: document.getElementById("city").value.trim(), state: document.getElementById("state").value.trim(), termsAccepted: document.getElementById("termsAccepted").checked
    };
}

document.getElementById("paymentForm").addEventListener("submit", async event => {
    event.preventDefault();
    const payload = formPayload();
    const button = document.getElementById("payButton");
    if (!planNames[selectedPlan]) return showMessage("Plano inválido.");
    if (payload.password.length < 8) return showMessage("A senha precisa ter pelo menos 8 caracteres.");
    if (payload.password !== payload.confirmPassword) return showMessage("As senhas não conferem.");
    if (!payload.termsAccepted) return showMessage("Você precisa aceitar os Termos de Uso e a Política de Privacidade.");
    button.disabled = true; showMessage("");
    try {
        const { payment } = await request("/api/payment/create", { method: "POST", body: JSON.stringify(payload) });
        transactionId = payment.transactionId;
        sessionStorage.setItem("luneflix_pending_payment", transactionId);
        openPix(payment);
        statusTimer = setInterval(checkStatus, 5000);
        checkStatus();
    } catch (error) { showMessage(error.message); button.disabled = false; }
});

document.getElementById("copyButton").addEventListener("click", async () => { try { await navigator.clipboard.writeText(document.getElementById("copyPaste").textContent); showMessage("Código PIX copiado.", "success"); } catch { showMessage("Não foi possível copiar o código PIX."); } });
setMask("cpf", formatCpf); setMask("phone", formatPhone); setMask("cep", formatCep);
document.getElementById("cep").addEventListener("blur", fillAddress);
document.getElementById("state").addEventListener("input", event => { event.target.value = event.target.value.toUpperCase().slice(0, 2); });
if (transactionId) {
    checkStatus().then(payment => {
        if (payment && payment.status === "pending") {
            openPix(payment);
            statusTimer = setInterval(checkStatus, 5000);
        }
    });
}
