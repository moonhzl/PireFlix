const API_URL = window.luneflixApiUrl;
const filmesContainer = document.getElementById("filmesContainer");
const seriesContainer = document.getElementById("seriesContainer");
const pesquisaContainer = document.getElementById("pesquisaContainer");
const pesquisa = document.getElementById("pesquisa");
const resultadosPesquisa = document.getElementById("resultadosPesquisa");
const tituloPesquisa = document.getElementById("tituloPesquisa");
const tituloFilmes = document.getElementById("tituloFilmes");
const tituloSeries = document.getElementById("tituloSeries");
const playerContainer = document.getElementById("playerContainer");
const player = document.getElementById("player");
const fecharPlayer = document.getElementById("fecharPlayer");
const detailModal = document.getElementById("detailModal");
const detailContent = document.getElementById("detailContent");
let filmes = [];
let series = [];
let timerPesquisa;
let pesquisaRequest = 0;
let currentUser = loadUser();
let episodeSelection = null;

function loadUser() {
    try { return JSON.parse(localStorage.getItem("luneflixUser") || "null"); } catch { return null; }
}

function saveUser(user) {
    currentUser = user;
    localStorage.setItem("luneflixUser", JSON.stringify(user));
}

async function buscarCatalogo(endpoint, container, renderer, errorText) {
    try {
        const resposta = await fetch(API_URL(`/api/${endpoint}`), { credentials: "include" });
        if (!resposta.ok) throw new Error(`Erro HTTP: ${resposta.status}`);
        const dados = await resposta.json();
        const items = dados.results || [];
        renderer(items, container);
        return items;
    } catch (erro) {
        console.error(erro);
        container.innerHTML = `<div class="loading">${errorText}</div>`;
        return [];
    }
}

function mostrarFilmes(lista, container) {
    container.innerHTML = "";
    if (!lista.length) { container.innerHTML = '<div class="loading">Nenhum filme encontrado.</div>'; return; }
    lista.forEach(item => container.appendChild(criarCard(item, "movie")));
}

function mostrarSeries(lista) {
    seriesContainer.innerHTML = "";
    if (!lista.length) { seriesContainer.innerHTML = '<div class="loading">Nenhuma série encontrada.</div>'; return; }
    lista.forEach(item => seriesContainer.appendChild(criarCard(item, "tv")));
}

function criarCard(item, tipo) {
    const card = document.createElement("div");
    card.className = "filme";
    const poster = item.poster || (item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "https://via.placeholder.com/500x750/111111/ffffff?text=Sem+Poster");
    const nome = item.title || item.name || "Sem título";
    const data = item.release_date || item.first_air_date;
    const ano = data ? data.substring(0, 4) : "----";
    const nota = typeof item.vote_average === "number" ? item.vote_average.toFixed(1) : "N/A";
    const generos = Array.isArray(item.genres) && item.genres.length ? item.genres.join(" • ") : "Gêneros não informados";
    card.innerHTML = `<img class="poster" src="${poster}" alt="${nome || "Sem título"}" loading="lazy" onerror="this.src='https://via.placeholder.com/500x750/111111/ffffff?text=Sem+Poster'"><div class="info"><div class="nome-filme">${nome || "Sem título"}</div><div class="detalhes"><span>${ano}</span><span class="tipo">${tipo === "movie" ? "Filme" : "Série"}</span><span class="nota">⭐ ${nota}</span></div></div><div class="generos-hover"><strong>Gêneros</strong><span>${generos}</span></div>`;
    card.tabIndex = 0;
    card.addEventListener("click", () => abrirDetalhes(item, tipo));
    card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") abrirDetalhes(item, tipo); });
    return card;
}

async function pesquisarTMDB(texto) {
    const requestId = ++pesquisaRequest;
    document.getElementById("filmes").style.display = "none";
    document.getElementById("series").style.display = "none";
    resultadosPesquisa.classList.add("ativo");
    tituloPesquisa.textContent = `Resultados para "${texto}"`;
    pesquisaContainer.innerHTML = '<div class="loading">Pesquisando...</div>';
    try {
        const resposta = await fetch(API_URL(`/api/search?q=${encodeURIComponent(texto)}`), { credentials: "include" });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.error || `Erro HTTP: ${resposta.status}`);
        if (requestId === pesquisaRequest) mostrarResultadosPesquisa(dados.results || []);
    } catch (erro) {
        if (requestId === pesquisaRequest) pesquisaContainer.innerHTML = `<div class="loading">${erro.message || "Erro ao pesquisar."}</div>`;
    }
}

function pesquisar() {
    clearTimeout(timerPesquisa);
    const texto = pesquisa.value.trim();
    if (!texto) { resetPesquisa(false); return; }
    timerPesquisa = setTimeout(() => pesquisarTMDB(texto), 350);
    setView("pesquisa", false);
}

function mostrarResultadosPesquisa(resultados) {
    pesquisaContainer.innerHTML = "";
    const filtrados = resultados.filter(item => item.media_type === "movie" || item.media_type === "tv");
    if (!filtrados.length) { pesquisaContainer.innerHTML = '<div class="loading">Nenhum filme ou série encontrado.</div>'; return; }
    filtrados.forEach(item => pesquisaContainer.appendChild(criarCard(item, item.media_type)));
}

function resetPesquisa(showCatalog = true) {
    clearTimeout(timerPesquisa);
    pesquisaRequest++;
    pesquisa.value = "";
    resultadosPesquisa.classList.remove("ativo");
    if (showCatalog) { document.getElementById("filmes").style.display = "block"; document.getElementById("series").style.display = "block"; }
    tituloFilmes.textContent = "Filmes populares";
    tituloSeries.textContent = "Séries populares";
}

function setView(view, push = true) {
    if (!["inicio", "filmes", "series", "pesquisa", "perfil"].includes(view)) view = "inicio";
    if (push) history.pushState({ view }, "", `#${view}`);
    if (view !== "pesquisa") resetPesquisa(true);
    resultadosPesquisa.classList.toggle("ativo", view === "pesquisa");
    document.querySelectorAll("[data-view]").forEach(link => link.classList.toggle("ativo", link.dataset.view === view));
    document.getElementById("perfil").style.display = view === "perfil" ? "block" : "none";
    if (view === "perfil") renderProfile();
    const target = { inicio: "inicio", filmes: "filmes", series: "series", pesquisa: "resultadosPesquisa", perfil: "perfil" }[view];
    document.getElementById(target).scrollIntoView({ behavior: "smooth" });
}

function currentView() { return location.hash.replace("#", "") || "inicio"; }

function abrirDetalhes(item, tipo) {
    episodeSelection = null;
    const nome = item.title || item.name || "Sem título";
    const poster = item.poster || (item.poster_path ? `https://image.tmdb.org/t/p/w780${item.poster_path}` : "https://via.placeholder.com/780x1170/111111/ffffff?text=Sem+Poster");
    const generos = Array.isArray(item.genres) ? item.genres.join(" • ") : "Não informado";
    const data = item.release_date || item.first_air_date;
    const rating = item.rating ?? item.vote_average;
    const nota = typeof rating === "number" ? rating.toFixed(1) : "N/A";
    const seasons = Array.isArray(item.seasons) ? item.seasons.filter(season => season.season_number > 0) : [];
    const seasonControl = tipo === "tv" && seasons.length ? `<label class="season-label" for="seasonSelect">Temporada</label><select id="seasonSelect">${seasons.map(season => `<option value="${season.season_number}">${season.name || `Temporada ${season.season_number}`}</option>`).join("")}</select><div id="episodeList" class="episode-list">Selecione uma temporada.</div>` : "";
    detailContent.innerHTML = `<div class="detail-layout"><img class="detail-poster" src="${poster}" alt="${nome}"><div class="detail-copy"><span class="detail-kicker">${tipo === "movie" ? "Filme" : "Série"}</span><h2 id="detailTitle">${nome}</h2><div class="detail-meta"><span>${data ? data.substring(0, 4) : "----"}</span><span>⭐ ${nota}</span><span>${item.certification || "Livre"}</span></div><p>${item.overview || "Sinopse indisponível para este título."}</p><p class="detail-genres"><strong>Categorias</strong> ${generos}</p>${seasonControl}<button type="button" class="watch-button" id="watchButton">Assistir agora</button></div></div>`;
    detailModal.classList.add("open");
    detailModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    document.getElementById("watchButton").addEventListener("click", () => abrirFilme({ ...item, ...(episodeSelection || {}) }, tipo));
    const seasonSelect = document.getElementById("seasonSelect");
    if (seasonSelect) { seasonSelect.addEventListener("change", () => carregarEpisodios(item.tmdb_id || item.id, seasonSelect.value)); carregarEpisodios(item.tmdb_id || item.id, seasonSelect.value); }
}

async function carregarEpisodios(tmdbId, season) {
    const list = document.getElementById("episodeList");
    if (!list) return;
    list.textContent = "Carregando episódios...";
    try {
        const response = await fetch(API_URL(`/api/series/${tmdbId}/seasons/${season}`), { credentials: "include" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        list.innerHTML = data.data.episodes.map(episode => `<button type="button" class="episode-item" data-episode="${episode.episode_number}"><strong>E${episode.episode_number} - ${episode.name}</strong><small>${episode.overview || "Sem sinopse."}</small></button>`).join("");
        list.querySelectorAll("[data-episode]").forEach(button => button.addEventListener("click", () => { episodeSelection = { tmdb_id: tmdbId, season, episode: button.dataset.episode }; list.querySelectorAll("[data-episode]").forEach(item => item.classList.remove("selected")); button.classList.add("selected"); }));
    } catch (error) { list.textContent = error.message || "Não foi possível carregar os episódios."; }
}

async function abrirFilme(item, tipo) {
    const params = new URLSearchParams({ type: tipo === "tv" || tipo === "series" ? "series" : "movie", imdb_id: item.imdb_id || "", tmdb_id: item.tmdb_id || item.id || "" });
    try {
        const response = await fetch(API_URL(`/api/player?${params}`), { credentials: "include" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível iniciar a reprodução.");
        fecharDetalhes();
        player.src = data.url;
    } catch (error) { alert(error.message); return; }
    playerContainer.style.display = "block";
    document.body.style.overflow = "hidden";
}

function fecharDetalhes() {
    detailModal.classList.remove("open");
    detailModal.setAttribute("aria-hidden", "true");
    if (playerContainer.style.display !== "block") document.body.style.overflow = "auto";
}

function fechar() {
    player.src = "";
    playerContainer.style.display = "none";
    document.body.style.overflow = "auto";
}

function irParaCatalogo() { setView("filmes"); }

function getAccounts() {
    try { return JSON.parse(localStorage.getItem("luneflixAccounts") || "[]"); } catch { return []; }
}

function renderProfile() {
    if (!currentUser) return;
    document.getElementById("perfilNome").value = currentUser.name || "";
    document.getElementById("perfilFoto").value = currentUser.avatar || "";
    document.getElementById("perfilEmail").textContent = currentUser.email || "";
    const planName = { free: "Gratuito", basic: "Básico", standard: "Padrão", family: "Padrão", premium: "Premium" }[currentUser.plan] || currentUser.plan || "Gratuito";
    document.getElementById("perfilPlano").textContent = `Plano ${planName}`;
    document.getElementById("perfilStatus").textContent = `Status: ${currentUser.status || "ativo"}`;
    document.getElementById("perfilExpiracao").textContent = currentUser.expires_at ? `Renovação: ${new Date(currentUser.expires_at).toLocaleDateString("pt-BR")}` : "Sem data de expiração cadastrada.";
    const avatar = document.getElementById("avatarPreview");
    avatar.style.backgroundImage = currentUser.avatar ? `url(${currentUser.avatar})` : "";
    avatar.textContent = currentUser.avatar ? "" : (currentUser.name || "L").charAt(0).toUpperCase();
    const accounts = getAccounts();
    document.getElementById("contasContainer").innerHTML = accounts.length ? accounts.map(account => `<button type="button" class="conta-item ${account.id === currentUser.id ? "selecionada" : ""}" data-account-id="${account.id}"><span>${account.name}</span><small>${account.email}</small><b data-remove-id="${account.id}">Remover</b></button>`).join("") : '<p class="perfil-muted">Nenhuma outra conta salva.</p>';
}

function saveCurrentAccount() {
    const accounts = getAccounts().filter(account => account.id !== currentUser.id);
    accounts.push(currentUser);
    localStorage.setItem("luneflixAccounts", JSON.stringify(accounts));
}

document.querySelectorAll("[data-view]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); setView(link.dataset.view); }));
pesquisa.addEventListener("input", pesquisar);
fecharPlayer.addEventListener("click", fechar);
document.getElementById("perfilForm").addEventListener("submit", async event => {
    event.preventDefault();
    const response = await fetch(API_URL("/api/profile"), { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: document.getElementById("perfilNome").value.trim(), avatar: document.getElementById("perfilFoto").value.trim() }) });
    const data = await response.json();
    if (!response.ok) return alert(data.error || "Não foi possível salvar o perfil.");
    saveUser(data.user);
    saveCurrentAccount();
    renderProfile();
});
document.getElementById("addAccountButton").addEventListener("click", () => { saveCurrentAccount(); window.location.href = "login.html"; });
document.querySelectorAll("[data-close-detail]").forEach(element => element.addEventListener("click", fecharDetalhes));
document.getElementById("logoutButton").addEventListener("click", async () => { await fetch(API_URL("/api/logout"), { method: "POST", credentials: "include" }); localStorage.removeItem("luneflixUser"); window.location.href = "login.html"; });
document.getElementById("contasContainer").addEventListener("click", event => {
    const removeId = event.target.dataset.removeId;
    if (removeId) { localStorage.setItem("luneflixAccounts", JSON.stringify(getAccounts().filter(account => String(account.id) !== String(removeId)))); renderProfile(); return; }
    const accountId = event.target.closest("[data-account-id]")?.dataset.accountId;
    const account = getAccounts().find(saved => String(saved.id) === String(accountId));
    if (account) { saveUser(account); renderProfile(); }
});
window.addEventListener("popstate", () => setView(currentView(), false));
window.addEventListener("hashchange", () => setView(currentView(), false));
async function initializeHome() {
    try {
        const response = await fetch(API_URL("/api/me"), { credentials: "include" });
        if (!response.ok) throw new Error("Sessão expirada");
        const data = await response.json();
        saveUser(data.user);
    } catch {
        window.location.href = "login.html";
        return;
    }
    buscarCatalogo("filmes", filmesContainer, mostrarFilmes, "Erro ao carregar os filmes.").then(items => { filmes = items; });
    buscarCatalogo("series", seriesContainer, items => mostrarSeries(items), "Erro ao carregar as séries.").then(items => { series = items; });
    setView(currentView(), false);
}
initializeHome();
