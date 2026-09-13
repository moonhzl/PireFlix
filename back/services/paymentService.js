const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const CASHINPAY_URL = "https://api.cashinpaybr.com/api/v1/transactions";
const CASHINPAY_KEY = (process.env.CASHINPAY_API_KEY || "").trim();
const WEBHOOK_SECRET = (process.env.CASHINPAY_WEBHOOK_SECRET || "").trim();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }) : null;

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

async function createPayment(user, payload) {
    ensureConfigured();
    const requestedPlan = String(payload.plan || "").toLowerCase();
    const planKey = LEGACY_PLAN_ALIASES[requestedPlan] || requestedPlan;
    const plan = PLANS[planKey];
    const phone = cleanDigits(payload.phone);
    const document = cleanDigits(payload.document);
    if (!plan) throw new Error("Plano inválido.");
    if (phone.length < 10 || phone.length > 11) throw new Error("Informe um telefone válido com DDD.");
    if (document.length !== 11) throw new Error("Informe um CPF válido.");
    const transactionId = `lune_${crypto.randomUUID().replace(/-/g, "")}`;
    const order = { id: `order_${crypto.randomUUID()}`, transaction_id: transactionId, user_id: user.id, plan: planKey, amount: plan.amount, status: "pending", created_at: now(), updated_at: now() };
    const { error: orderError } = await supabase.from("payment_orders").insert(order);
    if (orderError) throw new Error("Não foi possível criar o pedido.");
    try {
        const response = await requestCashInPay({
            amount: plan.amount,
            transaction_id: transactionId,
            customer: { name: user.name, email: user.email, phone, document: "CPF" },
            description: `LuneFlix — Plano ${plan.name}`
        });
        const data = response.data || response;
        const pix = data.pix || {};
        if (!data.id || !pix.qrcode || !pix.copy_paste) throw new Error("CashinPay não retornou os dados PIX esperados.");
        const patch = { provider_transaction_id: String(data.id), pix_qrcode: pix.qrcode, pix_copy_paste: pix.copy_paste, updated_at: now() };
        const { error: updateError } = await supabase.from("payment_orders").update(patch).eq("transaction_id", transactionId);
        if (updateError) throw new Error("Não foi possível salvar a cobrança PIX.");
        const { error: paymentError } = await supabase.from("payments").insert({ id: Date.now(), transaction_id: transactionId, user_id: user.id, plan: planKey, amount: plan.amount, status: "pending", provider: "cashinpay", provider_transaction_id: String(data.id), created_at: now(), updated_at: now() });
        if (paymentError) throw new Error("Não foi possível registrar o pagamento.");
        return publicOrder({ ...order, ...patch });
    } catch (error) {
        await supabase.from("payment_orders").update({ status: "failed", updated_at: now() }).eq("transaction_id", transactionId);
        throw error;
    }
}

async function getPayment(userId, transactionId) {
    ensureConfigured();
    const { data, error } = await supabase.from("payment_orders").select("*").eq("transaction_id", transactionId).eq("user_id", userId).maybeSingle();
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
    const event = { id: `event_${crypto.randomUUID()}`, provider_event_id: eventId, event_type: eventType, transaction_id: data.transaction_id || data.id || null, payload, created_at: now() };
    const { error: eventError } = await supabase.from("payment_webhook_events").insert(event);
    if (eventError && !/duplicate/i.test(eventError.message || "")) throw new Error("Não foi possível registrar o webhook.");
    const providerId = String(data.id || "");
    const merchantId = String(data.transaction_id || "");
    let query = supabase.from("payment_orders").select("*");
    const { data: order } = merchantId ? await query.eq("transaction_id", merchantId).maybeSingle() : await query.eq("provider_transaction_id", providerId).maybeSingle();
    if (order) {
        const statusMap = { "transaction.paid": "approved", "transaction.expired": "expired", "transaction.pending": "pending" };
        const status = statusMap[eventType];
        if (status) {
            const paidAt = status === "approved" ? (order.paid_at || now()) : order.paid_at;
            await supabase.from("payment_orders").update({ status, paid_at: paidAt, updated_at: now() }).eq("id", order.id);
            await supabase.from("payments").update({ status, paid_at: paidAt, updated_at: now() }).eq("transaction_id", order.transaction_id);
            if (status === "approved" && order.status !== "approved") await supabase.from("users").update({ plan: LEGACY_PLAN_ALIASES[order.plan] || order.plan, subscription_status: "active" }).eq("id", order.user_id);
        }
    }
    await supabase.from("payment_webhook_events").update({ processed_at: now() }).eq("provider_event_id", eventId);
}

module.exports = { createPayment, getPayment, processWebhook, verifySignature, PLANS };
