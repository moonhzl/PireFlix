const crypto = require("crypto");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");

const CASHINPAY_URL = "https://api.cashinpaybr.com/api/v1/transactions";
const CASHINPAY_KEY = (process.env.CASHINPAY_API_KEY || "").trim();
const WEBHOOK_SECRET = (process.env.CASHINPAY_WEBHOOK_SECRET || "").trim();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }) : null;
const TERMS_VERSION = "2026-09-13";
const PENDING_TTL_MS = 30 * 60 * 1000;

const PLANS = {
    basic: { name: "Básico", amount: 5.90 },
    standard: { name: "Padrão", amount: 12.90 },
    premium: { name: "Premium", amount: 24.90 }
};
const LEGACY_PLAN_ALIASES = { family: "standard" };

function now() { return new Date().toISOString(); }
function ensureConfigured() {
    if (!CASHINPAY_KEY) throw new Error("Pagamento PIX ainda não está configurado.");
    if (!supabase) throw new Error("Banco de pagamentos indisponível.");
}
function cleanDigits(value) { return String(value || "").replace(/\D/g, ""); }
function normalizedText(value) { return String(value || "").trim().replace(/\s+/g, " "); }
function isValidCpf(value) {
    if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
    const digit = size => {
        const sum = value.slice(0, size).split("").reduce((total, current, index) => total + Number(current) * (size + 1 - index), 0);
        const remainder = (sum * 10) % 11;
        return remainder === 10 ? 0 : remainder;
    };
    return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
}
function passwordRecord(password) {
    const salt = crypto.randomBytes(16);
    return { password_salt: salt.toString("hex"), password_hash: crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex") };
}
function publicOrder(order) {
    return { transactionId: order.transaction_id, plan: order.plan, amount: Number(order.amount), status: order.status, qrcode: order.pix_qrcode, copyPaste: order.pix_copy_paste, paidAt: order.paid_at };
}
function providerMessage(data, status) {
    const source = data?.error || data?.message || data?.errors;
    if (typeof source === "string") return source;
    if (Array.isArray(source)) return source.map(item => item?.message || item?.msg || String(item)).join("; ");
    if (source && typeof source === "object") return source.message || source.msg || source.code || `CashinPay retornou HTTP ${status}`;
    return `CashinPay recusou a cobrança (HTTP ${status}).`;
}
function redactedWebhook(value) {
    if (Array.isArray(value)) return value.map(redactedWebhook);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /cpf|document|phone|email|address/i.test(key) ? "[redacted]" : redactedWebhook(item)]));
}

async function requestCashInPay(body) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(CASHINPAY_URL, { method: "POST", headers: { Authorization: `Bearer ${CASHINPAY_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
            const data = await response.json().catch(() => ({}));
            if (response.ok) return data;
            if (response.status < 500) {
                const error = new Error(providerMessage(data, response.status));
                error.retryable = false;
                error.providerStatus = response.status;
                throw error;
            }
            lastError = new Error(`CashinPay retornou HTTP ${response.status}`);
        } catch (error) {
            if (error.retryable === false) throw error;
            lastError = error;
        }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }
    throw lastError || new Error("CashinPay indisponível.");
}

async function checkoutExists(email, username) {
    const [{ data: byEmail, error: emailError }, { data: byUsername, error: usernameError }, { data: pendingEmail, error: pendingEmailError }, { data: pendingUsername, error: pendingUsernameError }] = await Promise.all([
        supabase.from("users").select("id").eq("email", email).maybeSingle(),
        supabase.from("users").select("id").eq("username", username).maybeSingle(),
        supabase.from("pending_registrations").select("id").eq("email", email).eq("status", "pending").maybeSingle(),
        supabase.from("pending_registrations").select("id").eq("username", username).eq("status", "pending").maybeSingle()
    ]);
    if (emailError || usernameError || pendingEmailError || pendingUsernameError) throw new Error("Não foi possível validar o cadastro.");
    if (byEmail || pendingEmail) throw new Error("Este e-mail já possui um cadastro em andamento ou ativo.");
    if (byUsername || pendingUsername) throw new Error("Este nome de usuário já está em uso.");
}

function validateCheckout(payload) {
    const planKey = LEGACY_PLAN_ALIASES[String(payload.plan || "").toLowerCase()] || String(payload.plan || "").toLowerCase();
    const plan = PLANS[planKey];
    const name = normalizedText(payload.name);
    const email = String(payload.email || "").trim().toLowerCase();
    const username = String(payload.username || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const phone = cleanDigits(payload.phone);
    const cpf = cleanDigits(payload.cpf);
    const cep = cleanDigits(payload.cep);
    const street = normalizedText(payload.street);
    const number = normalizedText(payload.number);
    const complement = normalizedText(payload.complement) || null;
    const neighborhood = normalizedText(payload.neighborhood);
    const city = normalizedText(payload.city);
    const state = String(payload.state || "").trim().toUpperCase();
    if (!plan) throw new Error("Plano inválido.");
    if (name.length < 2 || name.length > 80) throw new Error("Informe seu nome completo.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) throw new Error("Informe um e-mail válido.");
    if (!/^[a-z0-9_]{3,30}$/.test(username)) throw new Error("O nome de usuário deve ter de 3 a 30 caracteres: letras, números ou _. ");
    if (password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== String(payload.confirmPassword || "")) throw new Error("As senhas não conferem.");
    if (phone.length < 10 || phone.length > 11) throw new Error("Informe um telefone válido com DDD.");
    if (!isValidCpf(cpf)) throw new Error("Informe um CPF válido.");
    if (cep.length !== 8 || !street || !number || !neighborhood || !city || !/^[A-Z]{2}$/.test(state)) throw new Error("Preencha um endereço válido.");
    if (payload.termsAccepted !== true) throw new Error("Você precisa aceitar os Termos de Uso e a Política de Privacidade.");
    return { planKey, plan, name, email, username, password, phone, cpf, cep, street, number, complement, neighborhood, city, state };
}

async function pixImage(qrcode, copyPaste) {
    if (/^data:image\//i.test(qrcode) || /^https?:\/\//i.test(qrcode)) return qrcode;
    if (/^iVBORw0KGgo/i.test(qrcode)) return `data:image/png;base64,${qrcode}`;
    return QRCode.toDataURL(copyPaste, { width: 320, margin: 2, errorCorrectionLevel: "M" });
}

async function createPayment(payload, context = {}) {
    ensureConfigured();
    const data = validateCheckout(payload);
    await supabase.rpc("expire_pending_registrations").catch(() => null);
    await checkoutExists(data.email, data.username);
    const transactionId = `lune_${crypto.randomUUID().replace(/-/g, "")}`;
    const pendingId = `registration_${crypto.randomUUID()}`;
    const createdAt = now();
    const expiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
    const password = passwordRecord(data.password);
    const pending = {
        id: pendingId, transaction_id: transactionId, plan: data.planKey, amount: data.plan.amount,
        name: data.name, email: data.email, username: data.username, ...password,
        cpf_hash: crypto.createHash("sha256").update(`${transactionId}:${data.cpf}`).digest("hex"), cpf_last2: data.cpf.slice(-2), phone: data.phone,
        cep: data.cep, street: data.street, number: data.number, complement: data.complement, neighborhood: data.neighborhood, city: data.city, state: data.state,
        signup_ip: context.ip || null, signup_user_agent: String(context.userAgent || "").slice(0, 500) || null,
        terms_accepted_at: createdAt, terms_version: TERMS_VERSION, expires_at: expiresAt, created_at: createdAt, updated_at: createdAt
    };
    const order = { id: `order_${crypto.randomUUID()}`, transaction_id: transactionId, pending_registration_id: pendingId, plan: data.planKey, amount: data.plan.amount, status: "pending", created_at: createdAt, updated_at: createdAt };
    const { error: pendingError } = await supabase.from("pending_registrations").insert(pending);
    if (pendingError) throw new Error("Não foi possível iniciar seu cadastro. Tente novamente.");
    const { error: orderError } = await supabase.from("payment_orders").insert(order);
    if (orderError) {
        await supabase.from("pending_registrations").update({ status: "failed", updated_at: now() }).eq("id", pendingId);
        throw new Error("Não foi possível criar o pedido.");
    }
    try {
        const response = await requestCashInPay({ amount: data.plan.amount, transaction_id: transactionId, customer: { name: data.name, email: data.email, phone: data.phone, document: data.cpf }, description: `LuneFlix — Plano ${data.plan.name}` });
        const provider = response.data || response;
        const pix = provider.pix || {};
        if (!provider.id || !pix.copy_paste) throw new Error("CashinPay não retornou os dados PIX esperados.");
        const patch = { provider_transaction_id: String(provider.id), pix_qrcode: await pixImage(pix.qrcode || pix.copy_paste, pix.copy_paste), pix_copy_paste: pix.copy_paste, updated_at: now() };
        const { error: updateError } = await supabase.from("payment_orders").update(patch).eq("transaction_id", transactionId);
        if (updateError) throw new Error("Não foi possível salvar a cobrança PIX.");
        return publicOrder({ ...order, ...patch });
    } catch (error) {
        await Promise.all([
            supabase.from("payment_orders").update({ status: "failed", updated_at: now() }).eq("transaction_id", transactionId),
            supabase.from("pending_registrations").update({ status: "failed", payment_status: "failed", updated_at: now() }).eq("id", pendingId)
        ]);
        throw error;
    }
}

async function getPayment(transactionId) {
    ensureConfigured();
    const { data, error } = await supabase.from("payment_orders").select("transaction_id, plan, amount, status, pix_qrcode, pix_copy_paste, paid_at").eq("transaction_id", transactionId).maybeSingle();
    if (error) throw new Error("Não foi possível consultar o pagamento.");
    if (!data) throw new Error("Pagamento não encontrado.");
    return publicOrder(data);
}

function verifySignature(rawBody, signature) {
    if (!WEBHOOK_SECRET || !signature) return false;
    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
    const received = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return received.length === expectedBuffer.length && crypto.timingSafeEqual(received, expectedBuffer);
}

async function processWebhook(rawBody, signature) {
    ensureConfigured();
    if (!verifySignature(rawBody, signature)) throw new Error("Assinatura de webhook inválida.");
    const payload = JSON.parse(rawBody.toString("utf8"));
    const data = payload.data || {};
    const eventType = payload.type || payload.event || "unknown";
    const eventId = String(payload.id || payload.event_id || crypto.createHash("sha256").update(rawBody).digest("hex"));
    const { data: previous } = await supabase.from("payment_webhook_events").select("id").eq("provider_event_id", eventId).maybeSingle();
    if (previous) return;
    const event = { id: `event_${crypto.randomUUID()}`, provider_event_id: eventId, event_type: eventType, transaction_id: data.transaction_id || data.id || null, payload: redactedWebhook(payload), created_at: now() };
    const { error: eventError } = await supabase.from("payment_webhook_events").insert(event);
    if (eventError && !/duplicate/i.test(eventError.message || "")) throw new Error("Não foi possível registrar o webhook.");
    const providerId = String(data.id || "");
    const merchantId = String(data.transaction_id || "");
    const { data: order } = merchantId
        ? await supabase.from("payment_orders").select("*").eq("transaction_id", merchantId).maybeSingle()
        : await supabase.from("payment_orders").select("*").eq("provider_transaction_id", providerId).maybeSingle();
    if (order) {
        const statusMap = { "transaction.paid": "approved", "transaction.expired": "expired", "transaction.pending": "pending", "transaction.cancelled": "cancelled" };
        const status = statusMap[eventType];
        if (status === "approved" && order.status !== "approved") {
            const reportedAmount = Number(data.amount ?? data.total_amount);
            if (Number.isFinite(reportedAmount) && Math.abs(reportedAmount - Number(order.amount)) > 0.001) throw new Error("Valor recebido divergente do pedido.");
            const paidAt = order.paid_at || now();
            if (order.pending_registration_id) {
                const { error } = await supabase.rpc("complete_pending_registration", { p_transaction_id: order.transaction_id, p_provider_transaction_id: providerId || order.provider_transaction_id, p_paid_at: paidAt });
                if (error) throw new Error("Não foi possível concluir o cadastro após o pagamento.");
            } else {
                await supabase.from("payment_orders").update({ status, paid_at: paidAt, updated_at: now() }).eq("id", order.id);
                await supabase.from("payments").update({ status, paid_at: paidAt, updated_at: now() }).eq("transaction_id", order.transaction_id);
                if (order.user_id) await supabase.from("users").update({ plan: LEGACY_PLAN_ALIASES[order.plan] || order.plan, subscription_status: "active" }).eq("id", order.user_id);
            }
        } else if (status) {
            await supabase.from("payment_orders").update({ status, updated_at: now() }).eq("id", order.id);
            if (order.pending_registration_id && ["expired", "cancelled"].includes(status)) await supabase.from("pending_registrations").update({ status, payment_status: status, updated_at: now() }).eq("id", order.pending_registration_id);
        }
    }
    await supabase.from("payment_webhook_events").update({ processed_at: now() }).eq("provider_event_id", eventId);
}

module.exports = { createPayment, getPayment, processWebhook, verifySignature, PLANS, TERMS_VERSION };
