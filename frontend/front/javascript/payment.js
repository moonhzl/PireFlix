const requestedPlan = new URLSearchParams(location.search).get("plan") || "basic";
const selectedPlan = requestedPlan === "family" ? "standard" : requestedPlan;
const planNames = { basic: "Básico", standard: "Padrão", premium: "Premium" };
const planPrices = { basic: "R$ 5,90", standard: "R$ 12,90", premium: "R$ 24,90" };
let transactionId;
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
function qrSource(value) { return /^https?:|^data:image/i.test(value) ? value : `data:image/png;base64,${value}`; }

async function ensureSession() {
    try { await request("/api/me"); } catch { location.href = `login.html?next=${encodeURIComponent(`payment.html?plan=${selectedPlan}`)}`; }
}
async function checkStatus() {
    if (!transactionId) return;
    try {
        const { payment } = await request(`/api/payment/${encodeURIComponent(transactionId)}`);
        const status = document.getElementById("paymentStatus");
        if (payment.status === "approved") { clearInterval(statusTimer); status.className = "payment-status approved"; status.innerHTML = "<i></i> Pagamento confirmado — seu plano foi liberado."; showMessage("Pagamento aprovado com sucesso!", "success"); }
        else if (["expired", "cancelled", "failed"].includes(payment.status)) { clearInterval(statusTimer); status.className = "payment-status failed"; status.innerHTML = "<i></i> Esta cobrança não está mais disponível."; }
    } catch (error) { clearInterval(statusTimer); showMessage(error.message); }
}

document.getElementById("paymentForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("payButton"); button.disabled = true; showMessage("");
    try {
        const { payment } = await request("/api/payment/create", { method: "POST", body: JSON.stringify({ plan: selectedPlan, phone: document.getElementById("phone").value, document: document.getElementById("document").value }) });
        transactionId = payment.transactionId;
        document.getElementById("checkoutCard").classList.add("hidden"); document.getElementById("pixCard").classList.remove("hidden");
        document.getElementById("qrcode").src = qrSource(payment.qrcode); document.getElementById("copyPaste").textContent = payment.copyPaste;
        statusTimer = setInterval(checkStatus, 5000); checkStatus();
    } catch (error) { showMessage(error.message); button.disabled = false; }
});
document.getElementById("copyButton").addEventListener("click", async () => { try { await navigator.clipboard.writeText(document.getElementById("copyPaste").textContent); showMessage("Código PIX copiado.", "success"); } catch { showMessage("Não foi possível copiar o código PIX."); } });
ensureSession();
