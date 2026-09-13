const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

let server;
const port = 3217;

function waitForServer() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Servidor não iniciou a tempo.")), 8000);
        server.stdout.on("data", chunk => {
            if (chunk.toString().includes(`localhost:${port}`)) {
                clearTimeout(timeout);
                resolve();
            }
        });
        server.on("error", reject);
    });
}

test.before(async () => {
    server = spawn(process.execPath, ["back/server.js"], { env: { ...process.env, PORT: String(port) } });
    await waitForServer();
});

test.after(() => server.kill());

test("recusa sessão ausente", async () => {
    const response = await fetch(`http://localhost:${port}/api/me`);
    assert.equal(response.status, 401);
});

test("recusa player sem sessão", async () => {
    const response = await fetch(`http://localhost:${port}/api/player?type=movie&imdb_id=tt1234567`);
    assert.equal(response.status, 401);
});

test("checkout PIX permite iniciar cadastro sem sessão", async () => {
    const response = await fetch(`http://localhost:${port}/api/payment/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "basic" })
    });
    assert.notEqual(response.status, 401);
});

test("rota antiga de cadastro redireciona para os planos", async () => {
    const response = await fetch(`http://localhost:${port}/front/pages/register.html`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/#plans");
});

test("mantém os três planos e os preços atuais no checkout", () => {
    const { PLANS } = require("../back/services/paymentService");
    assert.deepEqual(PLANS, {
        basic: { name: "Básico", amount: 5.90 },
        standard: { name: "Padrão", amount: 12.90 },
        premium: { name: "Premium", amount: 24.90 }
    });
    assert.equal("family" in PLANS, false);
});

test("recuperação não revela se o e-mail existe", async () => {
    const response = await fetch(`http://localhost:${port}/api/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nao-existe@example.com" })
    });
    const data = await response.json();
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        assert.equal(response.status, 200);
        assert.equal(data.ok, true);
        assert.match(data.message, /Se o e-mail existir/);
    } else {
        assert.equal(response.status, 503);
    }
});

test("a busca prioriza o título mais relevante para a query", async () => {
    const catalogService = require("../back/services/catalogService");
    const originalRunCatalog = catalogService.runCatalog;
    const originalExternalFetch = catalogService.externalFetch;

    catalogService.runCatalog = async payload => {
        if (payload.action === "search") {
            return { ok: true, data: [] };
        }
        if (payload.action === "upsert") {
            return { ok: true, data: { ...payload.item, title: payload.item.title || "Sem título", id: String(payload.item.tmdb_id || payload.item.imdb_id || "local") } };
        }
        throw new Error(`Ação inesperada: ${payload.action}`);
    };

    catalogService.externalFetch = async endpoint => {
        if (endpoint.includes("/search/") && endpoint.includes("query=clash%20of%20the%20titans")) {
            return {
                results: [
                    { id: 11, media_type: "movie", title: "Titans: O Ataque", original_title: "Titans: The Attack", vote_average: 6.2, overview: "" },
                    { id: 22, media_type: "movie", title: "Clash of the Titans", original_title: "Clash of the Titans", vote_average: 7.8, overview: "" },
                    { id: 33, media_type: "movie", title: "Titanes da Guerra", original_title: "Titanes da Guerra", vote_average: 5.9, overview: "" }
                ]
            };
        }
        if (endpoint.includes("/movie/11")) {
            return { id: 11, title: "Titans: O Ataque", original_title: "Titans: The Attack", imdb_id: "tt11", vote_average: 6.2, overview: "", poster_path: null, backdrop_path: null, release_date: "2008-01-01", genres: [{ name: "Ação" }] };
        }
        if (endpoint.includes("/movie/22")) {
            return { id: 22, title: "Clash of the Titans", original_title: "Clash of the Titans", imdb_id: "tt22", vote_average: 7.8, overview: "", poster_path: null, backdrop_path: null, release_date: "2010-03-26", genres: [{ name: "Fantasia" }] };
        }
        if (endpoint.includes("/movie/33")) {
            return { id: 33, title: "Titanes da Guerra", original_title: "Titanes da Guerra", imdb_id: "tt33", vote_average: 5.9, overview: "", poster_path: null, backdrop_path: null, release_date: "2014-01-01", genres: [{ name: "Ação" }] };
        }
        return {};
    };

    try {
        const results = await catalogService.search("clash of the titans");
        assert.equal(results[0].title, "Clash of the Titans");
        assert.ok(results[0].rating >= 7);
    } finally {
        catalogService.runCatalog = originalRunCatalog;
        catalogService.externalFetch = originalExternalFetch;
    }
});

test("a busca encontra títulos sem acento, com pontuação diferente e com pequeno erro", async () => {
    const catalogService = require("../back/services/catalogService");
    const originalRunCatalog = catalogService.runCatalog;
    const originalExternalFetch = catalogService.externalFetch;

    catalogService.runCatalog = async payload => {
        if (payload.action === "search") return { ok: true, data: [] };
        if (payload.action === "upsert") return { ok: true, data: { ...payload.item, id: String(payload.item.tmdb_id) } };
        throw new Error(`Ação inesperada: ${payload.action}`);
    };
    catalogService.externalFetch = async endpoint => {
        if (endpoint.includes("/search/") && endpoint.includes("query=homem%20aranha")) return { results: [
            { id: 1, media_type: "movie", title: "Homem-Aranha: Sem Volta para Casa", vote_average: 8.2 },
            { id: 2, media_type: "movie", title: "O Homem de Ferro", vote_average: 9.5 }
        ] };
        if (endpoint.includes("/search/movie") && endpoint.includes("query=harry%20potter")) return { results: [
            { id: 5, title: "Harry Potter e a Pedra Filosofal", vote_average: 7.9 }
        ] };
        if (endpoint.includes("/search/tv") && endpoint.includes("query=harry%20potter")) return { results: [
            { id: 4, name: "Harry O", vote_average: 5.2 }
        ] };
        if (endpoint.includes("/search/") && endpoint.includes("query=interstelar")) return { results: [] };
        if (endpoint.includes("/search/") && endpoint.includes("query=inter")) return { results: [
            { id: 3, media_type: "movie", title: "Interestelar", original_title: "Interstellar", vote_average: 8.7 }
        ] };
        if (endpoint.includes("/movie/1")) return { id: 1, title: "Homem-Aranha: Sem Volta para Casa", imdb_id: "tt1", vote_average: 8.2, genres: [] };
        if (endpoint.includes("/movie/2")) return { id: 2, title: "O Homem de Ferro", imdb_id: "tt2", vote_average: 9.5, genres: [] };
        if (endpoint.includes("/movie/3")) return { id: 3, title: "Interestelar", original_title: "Interstellar", imdb_id: "tt3", vote_average: 8.7, genres: [] };
        if (endpoint.includes("/tv/4")) return { id: 4, name: "Harry O", vote_average: 5.2, genres: [] };
        if (endpoint.includes("/movie/5")) return { id: 5, title: "Harry Potter e a Pedra Filosofal", imdb_id: "tt5", vote_average: 7.9, genres: [] };
        return { results: [] };
    };

    try {
        const spider = await catalogService.search("homem aranha");
        const harry = await catalogService.search("harry potter");
        const typo = await catalogService.search("interstelar");
        assert.equal(spider[0].title, "Homem-Aranha: Sem Volta para Casa");
        assert.deepEqual(harry.map(item => item.title), ["Harry Potter e a Pedra Filosofal"]);
        assert.equal(typo[0].title, "Interestelar");
    } finally {
        catalogService.runCatalog = originalRunCatalog;
        catalogService.externalFetch = originalExternalFetch;
    }
});

test("o fallback local não devolve títulos que cobrem apenas parte da pesquisa", async () => {
    const catalogService = require("../back/services/catalogService");
    const originalRunCatalog = catalogService.runCatalog;
    const originalExternalFetch = catalogService.externalFetch;
    catalogService.runCatalog = async payload => payload.action === "search"
        ? { ok: true, data: [{ type: "series", title: "Harry O", original_title: "Harry O", tmdb_id: 10944, rating: 5.2 }] }
        : { ok: true, data: payload.item };
    catalogService.externalFetch = async () => { throw new Error("TMDB indisponível"); };

    try {
        await assert.rejects(() => catalogService.search("harry potter"), /TMDB indisponível/);
    } finally {
        catalogService.runCatalog = originalRunCatalog;
        catalogService.externalFetch = originalExternalFetch;
    }
});
