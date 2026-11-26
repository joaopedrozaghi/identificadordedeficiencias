// ============================================================
// Analisador de Provas - script.js
// ============================================================
const API = "http://127.0.0.1:8000";
let DADOS_GLOBAL = null;

function ligarDrop(dropId, inputId, nameId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const nome = document.getElementById(nameId);
    input.addEventListener("change", () => {
        if (input.files.length > 0) {
            const f = input.files[0];
            const tam = f.size >= 1048576 ? (f.size/1048576).toLocaleString("pt-BR",{maximumFractionDigits:1}) + " MB"
                                          : Math.max(1, Math.round(f.size/1024)) + " KB";
            nome.textContent = `${f.name} · ${tam}`;
            drop.classList.add("filled");
        }
    });
}
ligarDrop("drop-prova", "file-prova", "name-prova");
ligarDrop("drop-arq1", "file-arq1", "name-arq1");
ligarDrop("drop-arq3", "file-arq3", "name-arq3");

document.getElementById("btn-analisar").addEventListener("click", async () => {
    const prova = document.getElementById("file-prova").files[0];
    const arq1 = document.getElementById("file-arq1").files[0];
    const arq3 = document.getElementById("file-arq3").files[0];
    const coGrupo = document.getElementById("co-grupo").value;
    const nomeAnalise = document.getElementById("nome-analise").value || ("Análise " + new Date().toLocaleString("pt-BR"));

    if (!prova || !arq1 || !arq3) {
        alert("Selecione os 3 arquivos: prova, arq1 e arq3.");
        return;
    }

    const progressBox = document.getElementById("progress-box");
    const progressText = document.getElementById("progress-text");
    const etapas = [...document.querySelectorAll("#etapas li")];
    const botao = document.getElementById("btn-analisar");
    progressBox.classList.remove("erro", "ok");
    progressBox.style.display = "block";
    document.getElementById("results").style.display = "none";
    botao.disabled = true;
    progressBox.scrollIntoView({ behavior: "smooth", block: "center" });

    const mensagens = [
        "Enviando os arquivos para o servidor.",
        "Lendo o PDF e separando as questões.",
        "Classificando o tema de cada questão.",
        "Calculando acerto, discriminação e distratores.",
        "Escrevendo o diagnóstico. Esta é a etapa mais demorada (cerca de 2 minutos).",
        "Pronto."
    ];
    // Avanca as etapas pelo tempo tipico de cada uma; para na escrita do diagnostico
    const tempos = [0, 3000, 8000, 16000, 25000];
    const marcar = (i) => {
        etapas.forEach((li, k) => { li.className = k < i ? "feita" : (k === i ? "atual" : ""); });
        progressText.textContent = mensagens[i];
    };
    marcar(0);
    const timers = tempos.slice(1).map((t, k) => setTimeout(() => marcar(k + 1), t));
    const parar = () => { timers.forEach(clearTimeout); botao.disabled = false; };

    const form = new FormData();
    form.append("prova", prova);
    form.append("arq1", arq1);
    form.append("arq3", arq3);
    form.append("co_grupo", coGrupo);
    form.append("nome", nomeAnalise);

    try {
        const resp = await fetch(API + "/analisar", { method: "POST", body: form });
        const dados = await resp.json();
        parar();

        if (dados.erro) { progressBox.classList.add("erro"); progressText.textContent = "Não foi possível concluir a análise: " + dados.erro; return; }

        marcar(5);
        progressBox.classList.add("ok");
        await new Promise(r => setTimeout(r, 900));
        progressBox.style.display = "none";
        DADOS_GLOBAL = dados;
        mostrarResultados(dados);
        carregarHistorico();
    } catch (e) {
        parar();
        progressBox.classList.add("erro");
        progressText.textContent = "Sem conexão com o servidor. Confira se o backend está rodando em " + API + ".";
    }
});

function mostrarResultados(dados) {
    const results = document.getElementById("results");
    results.style.display = "block";
    document.getElementById("results-titulo").textContent = dados.nome || "Resultados";
    document.getElementById("results-meta").textContent =
        `${Number(dados.num_alunos).toLocaleString("pt-BR")} alunos · ${dados.tabela.length} questões válidas` +
        (dados.data ? ` · analisada em ${dados.data}` : "");

    const pior = [...dados.ranking].sort((a,b)=>a.media_acerto-b.media_acerto)[0];
    document.getElementById("cards").innerHTML = `
        <div class="card"><div class="card-num">${Number(dados.num_alunos).toLocaleString("pt-BR")}</div><div class="card-label">Alunos analisados</div></div>
        <div class="card"><div class="card-num">${dados.tabela.length}</div><div class="card-label">Questões válidas</div></div>
        <div class="card"><div class="card-num">${dados.ranking.length}</div><div class="card-label">Temas identificados</div></div>
        <div class="card"><div class="card-num">${pct(pior.media_acerto)}</div><div class="card-label">de acerto em ${pior.tema}, o tema mais frágil</div></div>
    `;

    const selTema = document.getElementById("filtro-tema");
    selTema.innerHTML = '<option value="todos">Todos os temas</option>';
    [...new Set(dados.tabela.map(t => t.tema))].sort().forEach(t => {
        selTema.innerHTML += `<option value="${t}">${t}</option>`;
    });

    desenharTudo();
    montarDiagnostico(dados);
    results.scrollIntoView({ behavior: "smooth" });
}

function desenharTudo() {
    const dados = DADOS_GLOBAL;
    const tema = document.getElementById("filtro-tema").value;
    const nivel = document.getElementById("filtro-nivel").value;

    let tabela = [...dados.tabela];
    if (tema !== "todos") tabela = tabela.filter(t => t.tema === tema);
    if (nivel !== "todos") {
        tabela = tabela.filter(t => {
            if (nivel === "dificil") return t.pct_acerto < 30;
            if (nivel === "medio") return t.pct_acerto >= 30 && t.pct_acerto < 50;
            if (nivel === "facil") return t.pct_acerto >= 50;
        });
    }

    const rk = [...dados.ranking].sort((a,b)=>a.media_acerto-b.media_acerto);
    Plotly.newPlot("grafico-ranking", [{
        type:"bar", orientation:"h",
        x: rk.map(r=>r.media_acerto), y: rk.map(r=>r.tema),
        text: rk.map(r=>pct(r.media_acerto)), textposition:"outside",
        marker:{color: rk.map(r=>cor(r.media_acerto))},
        textfont:{color:"#1b1f1c", size:12}, cliponaxis:false,
        hovertemplate:"<b>%{y}</b><br>Acerto: %{x}%<extra></extra>"
    }], Object.assign(layoutG(Math.max(260, rk.length*34+60)), {bargap:0.35,
        yaxis:{autorange:"reversed", tickfont:{color:"#1b1f1c", size:13}, automargin:true},
        xaxis:{gridcolor:"#eceeea", zeroline:false, ticksuffix:"%", tickfont:{color:"#5d645f", size:12}}}), {responsive:true, displayModeBar:false});

    const tb = [...tabela].sort((a,b)=>a.pct_acerto-b.pct_acerto);
    Plotly.newPlot("grafico-dificuldade", [{
        type:"bar",
        x: tb.map(t=>"Q"+t.questao_prova), y: tb.map(t=>t.pct_acerto),
        text: tb.map(t=>pct(t.pct_acerto)), textposition:"none",
        marker:{color: tb.map(t=>cor(t.pct_acerto))},
        textfont:{color:"#5d645f", size:11}, cliponaxis:false,
        hovertemplate:"<b>%{x}</b><br>Acerto: %{y}%<extra></extra>"
    }], Object.assign(layoutG(360), {margin:{l:40,r:10,t:20,b:40}, bargap:0.25,
        yaxis:{gridcolor:"#eceeea", zeroline:false, ticksuffix:"%", tickfont:{color:"#5d645f", size:12}}}), {responsive:true, displayModeBar:false});

    Plotly.newPlot("grafico-mapa", [{
        type:"scatter", mode:"markers+text",
        x: tabela.map(t=>t.pct_acerto), y: tabela.map(t=>t.indice_discriminacao),
        text: tabela.map(t=>"Q"+t.questao_prova), textposition:"top center",
        textfont:{color:"#5d645f", size:10},
        marker:{ size: tabela.map(t=> Math.max(8, (t.distrator_pct||10)/2) ), color: tabela.map(t=>cor(t.pct_acerto)), opacity:0.9, line:{width:0} },
        hovertemplate:"<b>%{text}</b><br>Acerto: %{x}%<br>Discriminação: %{y:.2f}<extra></extra>"
    }], Object.assign(layoutG(360), {
        margin:{l:56,r:10,t:20,b:50},
        xaxis:{title:{text:"Acerto (%)", font:{color:"#5d645f", size:12}}, gridcolor:"#eceeea", zeroline:false, tickfont:{color:"#5d645f", size:12}},
        yaxis:{title:{text:"Discriminação", font:{color:"#5d645f", size:12}}, gridcolor:"#eceeea", zeroline:false, tickfont:{color:"#5d645f", size:12}},
        shapes:[{type:"line", x0:0, x1:100, y0:0.2, y1:0.2, line:{color:"#8a918c", width:1, dash:"dash"}}],
        annotations:[{x:100, y:0.2, xanchor:"right", yanchor:"bottom", text:"limite 0,20", showarrow:false, font:{size:11, color:"#5d645f"}}]
    }), {responsive:true, displayModeBar:false});

    const busca = document.getElementById("busca-tabela").value.toLowerCase();
    let linhas = tabela.filter(t => t.tema.toLowerCase().includes(busca));
    let html = "<table class='tabela'><tr><th>Questão</th><th>Tema</th><th>Acerto</th><th>Discriminação</th><th>Distrator mais marcado</th></tr>";
    linhas.sort((a,b)=>a.pct_acerto-b.pct_acerto).forEach(t => {
        html += `<tr><td>Q${t.questao_prova}</td><td>${t.tema}</td><td>${pct(t.pct_acerto)}</td><td>${nomeDiscr(t.classif_discriminacao)}</td><td>${t.distrator} (${pct(t.distrator_pct)})</td></tr>`;
    });
    html += "</table>";
    document.getElementById("tabela-container").innerHTML = html;
}

function cor(v){
    if(v < 30) return "#b3401f";   // dificil
    if(v < 50) return "#c99a2e";   // medio
    return "#9bb5a4";              // facil
}
function layoutG(altura){
    return { separators: ",.", height:altura, paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)",
        font:{family:"IBM Plex Sans, Segoe UI, sans-serif", color:"#1b1f1c", size:13},
        margin:{l:200,r:50,t:10,b:40},
        hoverlabel:{bgcolor:"#1b1f1c", bordercolor:"#1b1f1c", font:{color:"#fff", family:"IBM Plex Sans, sans-serif"}},
        xaxis:{gridcolor:"#eceeea", zeroline:false, tickfont:{color:"#5d645f", size:12}},
        yaxis:{gridcolor:"#eceeea", zeroline:false, tickfont:{color:"#5d645f", size:12}, automargin:true} };
}

function trocarAba(qual){
    document.getElementById("aba-enade").style.display = (qual==="enade")?"block":"none";
    document.getElementById("aba-ada").style.display = (qual==="ada")?"block":"none";
    document.getElementById("tab-enade").classList.toggle("active", qual==="enade");
    document.getElementById("tab-ada").classList.toggle("active", qual==="ada");
}

// ============================================================
// HISTORICO
// ============================================================
async function carregarHistorico() {
    try {
        const resp = await fetch(API + "/historico");
        const lista = await resp.json();
        const grid = document.getElementById("historico-grid");
        if (!lista || lista.length === 0) {
            grid.innerHTML = '<p>Nenhuma análise salva ainda.</p>';
            return;
        }
        grid.innerHTML = "";
        lista.forEach(item => {
            const card = document.createElement("div");
            card.className = "hist-card";
            card.innerHTML = `
                <div class="hist-nome">${item.nome}</div>
                <div class="hist-info">${Number(item.num_alunos).toLocaleString("pt-BR")} alunos · ${item.data}</div>
                <div class="hist-acoes">
                    <button class="hist-btn-ver" onclick="verAnalise('${item.id}')">Abrir</button>
                    <button class="hist-btn-del" onclick="apagarAnalise('${item.id}', event)" >Apagar</button>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (e) {
        console.log("Erro ao carregar historico:", e);
    }
}

async function verAnalise(id) {
    try {
        const resp = await fetch(API + "/historico/" + id);
        const dados = await resp.json();
        if (dados.erro) { alert(dados.erro); return; }
        DADOS_GLOBAL = dados;
        mostrarResultados(dados);
    } catch (e) {
        alert("Erro ao carregar: " + e.message);
    }
}

async function apagarAnalise(id, ev) {
    ev.stopPropagation();
    if (!confirm("Apagar esta análise salva?")) return;
    await fetch(API + "/historico/" + id, { method: "DELETE" });
    carregarHistorico();
}

carregarHistorico();

// ============================================================
// DIAGNOSTICO: resumo calculado dos dados + texto estruturado
// ============================================================
const DISCR = { fraca: "Fraca", razoavel: "Razoável", boa: "Boa", otima: "Ótima" };
function nomeDiscr(c){ return DISCR[String(c||"").toLowerCase()] || c || "—"; }
function fmt(v){ return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }); }
function pct(v){ return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; }
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

// Palavras que o modelo costuma escrever sem acento nos titulos
const ACENTOS = { diagnostico:"diagnóstico", recomendacoes:"recomendações", recomendacao:"recomendação",
    praticas:"práticas", pratica:"prática", analise:"análise", questoes:"questões", questao:"questão",
    conclusao:"conclusão", consideracoes:"considerações", discriminacao:"discriminação", pedagogico:"pedagógico" };
function titulo(s){
    s = s.toLowerCase().replace(/[a-zçãõáéíóú]+/g, w => ACENTOS[w] || w);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Converte o texto (markdown simples) em blocos: h4, h5, p, li
function textoParaBlocos(txt){
    const blocos = [];
    String(txt || "").split(/\r?\n/).forEach(bruta => {
        const l = bruta.trim();
        if (!l) return;
        let m;
        if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
            const t = m[2].replace(/\*\*/g,"").replace(/:$/,"").replace(/^\d+[\).]\s*/,"");
            blocos.push({ t: m[1].length <= 2 ? "h4" : "h5", s: t === t.toUpperCase() ? titulo(t) : t });
            return;
        }
        if ((m = l.match(/^(?:\d+[\).]\s*)?\*\*([^*]+)\*\*:?$/)) || (m = l.match(/^(?:\d+[\).]\s*)?([A-ZÇÃÕÁÉÍÓÚ0-9 ,\-]{6,}):?$/))) {
            const t = m[1].trim().replace(/:$/,"").replace(/^\d+[\).]\s*/,"");
            const caixaAlta = t === t.toUpperCase() && /[A-Z]/.test(t);
            blocos.push({ t: caixaAlta ? "h4" : "h5", s: caixaAlta ? titulo(t) : t });
            return;
        }
        if ((m = l.match(/^[*\-•]\s+(.*)$/))) { blocos.push({ t: "li", s: m[1] }); return; }
        if ((m = l.match(/^(\d+)[.)]\s+(.*)$/))) { blocos.push({ t: "li", s: m[2], n: m[1] }); return; }
        blocos.push({ t: "p", s: l });
    });
    return blocos;
}
function negrito(s){ return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*/g, ""); }

function blocosParaHtml(blocos){
    let html = "", lista = null;
    const fecha = () => { if (lista) { html += `</${lista}>`; lista = null; } };
    blocos.forEach(b => {
        if (b.t === "li") {
            const tipo = b.n ? "ol" : "ul";
            if (lista !== tipo) { fecha(); html += `<${tipo}>`; lista = tipo; }
            html += `<li>${negrito(b.s)}</li>`;
            return;
        }
        fecha();
        html += `<${b.t}>${negrito(b.s)}</${b.t}>`;
    });
    fecha();
    return html;
}

// Numeros calculados direto da tabela (nada vem do modelo)
function resumoDados(dados){
    const temas = [...dados.ranking].sort((a,b)=>a.media_acerto-b.media_acerto).slice(0,3);
    const criticas = [...dados.tabela].sort((a,b)=>a.pct_acerto-b.pct_acerto).slice(0,5);
    const discr = {};
    dados.tabela.forEach(t => { const k = nomeDiscr(t.classif_discriminacao); discr[k] = (discr[k]||0) + 1; });
    const ordem = ["Ótima","Boa","Razoável","Fraca"];
    const discrLista = ordem.filter(k => discr[k]).map(k => ({ nome:k, n:discr[k] }))
        .concat(Object.keys(discr).filter(k => !ordem.includes(k)).map(k => ({ nome:k, n:discr[k] })));
    const distratores = dados.tabela.filter(t => t.distrator_pct > t.pct_acerto)
        .sort((a,b)=>a.questao_prova-b.questao_prova);
    const media = dados.tabela.reduce((a,t)=>a+t.pct_acerto,0) / (dados.tabela.length||1);
    return { temas, criticas, discrLista, distratores, media };
}

function montarDiagnostico(dados){
    const r = resumoDados(dados);
    const data = dados.data || new Date().toLocaleDateString("pt-BR");
    document.getElementById("diag-meta").textContent =
        `${dados.nome || "Análise"} · ${fmt(dados.num_alunos)} alunos · ${dados.tabela.length} questões · ${data}`;

    const maxDiscr = Math.max(...r.discrLista.map(d=>d.n), 1);
    document.getElementById("diag-resumo").innerHTML = `
        <div class="resumo-bloco">
            <h4>Acerto médio da prova</h4>
            <p class="resumo-num">${pct(r.media)}</p>
            <p class="resumo-nota">média das ${dados.tabela.length} questões válidas</p>
        </div>
        <div class="resumo-bloco">
            <h4>Temas mais frágeis</h4>
            <ul class="resumo-temas">${r.temas.map(t => `
                <li><span class="rt-nome">${esc(t.tema)}</span><span class="rt-num">${pct(t.media_acerto)}</span>
                <span class="rt-barra"><i style="width:${Math.max(2,t.media_acerto)}%;background:${cor(t.media_acerto)}"></i></span></li>`).join("")}
            </ul>
        </div>
        <div class="resumo-bloco">
            <h4>Questões com menor acerto</h4>
            <table class="resumo-tab">${r.criticas.map(t => `
                <tr><td class="rq">Q${t.questao_prova}</td><td class="rtema">${esc(t.tema)}</td><td class="rpct">${pct(t.pct_acerto)}</td></tr>`).join("")}
            </table>
        </div>
        <div class="resumo-bloco">
            <h4>Discriminação das questões</h4>
            <ul class="resumo-discr">${r.discrLista.map(d => `
                <li><span>${d.nome}</span><span class="rd-barra"><i style="width:${d.n/maxDiscr*100}%"></i></span><span class="rd-num">${d.n}</span></li>`).join("")}
            </ul>
            <p class="resumo-nota">${r.distratores.length
                ? `Em ${r.distratores.length} ${r.distratores.length>1?"questões":"questão"} uma alternativa errada foi mais marcada que a correta: ${r.distratores.map(t=>"Q"+t.questao_prova).join(", ")}.`
                : "Em nenhuma questão uma alternativa errada superou a correta."}</p>
        </div>`;

    document.getElementById("diagnostico").innerHTML = blocosParaHtml(textoParaBlocos(dados.diagnostico));
}

// ============================================================
// BAIXAR O DIAGNOSTICO EM PDF
// ============================================================
function baixarPDF() {
    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF("p", "mm", "a4");
        const dados = DADOS_GLOBAL;
        const r = resumoDados(dados);
        const nome = dados.nome || "Análise";
        const data = dados.data || new Date().toLocaleDateString("pt-BR");
        const ME = 20, LARG = 210 - ME*2, FIM = 280;
        const TINTA = [27,31,28], CINZA = [93,100,95], VERDE = [31,107,71], LINHA = [215,219,213];
        let y = 22;

        const corTexto = c => pdf.setTextColor(c[0], c[1], c[2]);
        const quebra = (h) => { if (y + h > FIM) { pdf.addPage(); y = 22; } };
        const limpa = s => String(s).replace(/\*\*/g, "").replace(/\*/g, "");

        // Cabecalho
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); corTexto(TINTA);
        pdf.text("Diagnóstico pedagógico", ME, y); y += 7;
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); corTexto(CINZA);
        pdf.text(`${nome}  ·  ${fmt(dados.num_alunos)} alunos  ·  ${dados.tabela.length} questões  ·  ${data}`, ME, y); y += 5;
        pdf.setDrawColor(VERDE[0], VERDE[1], VERDE[2]); pdf.setLineWidth(0.6);
        pdf.line(ME, y, ME + LARG, y); y += 10;

        // Resumo dos dados (duas colunas)
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); corTexto(TINTA);
        pdf.text("Resumo dos dados", ME, y); y += 7;
        const col2 = ME + LARG/2 + 4;
        let yE = y, yD = y;

        pdf.setFontSize(9.5); pdf.setFont("helvetica", "bold"); corTexto(CINZA);
        pdf.text("Temas mais frágeis", ME, yE); yE += 5.5;
        pdf.setFont("helvetica", "normal"); corTexto(TINTA);
        r.temas.forEach(t => {
            pdf.text(pdf.splitTextToSize(t.tema, LARG/2 - 22)[0], ME, yE);
            pdf.text(pct(t.media_acerto), ME + LARG/2 - 6, yE, { align: "right" });
            yE += 5;
        });
        yE += 3;
        pdf.setFont("helvetica", "bold"); corTexto(CINZA);
        pdf.text("Acerto médio da prova", ME, yE); yE += 5.5;
        pdf.setFont("helvetica", "normal"); corTexto(TINTA);
        pdf.text(pct(r.media), ME, yE); yE += 5;

        pdf.setFont("helvetica", "bold"); corTexto(CINZA);
        pdf.text("Questões com menor acerto", col2, yD); yD += 5.5;
        pdf.setFont("helvetica", "normal"); corTexto(TINTA);
        r.criticas.forEach(t => {
            pdf.text("Q" + t.questao_prova, col2, yD);
            pdf.text(pdf.splitTextToSize(t.tema, LARG/2 - 32)[0], col2 + 11, yD);
            pdf.text(pct(t.pct_acerto), ME + LARG, yD, { align: "right" });
            yD += 5;
        });
        yD += 3;
        pdf.setFont("helvetica", "bold"); corTexto(CINZA);
        pdf.text("Discriminação", col2, yD); yD += 5.5;
        pdf.setFont("helvetica", "normal"); corTexto(TINTA);
        pdf.text(r.discrLista.map(d => `${d.nome}: ${d.n}`).join("   "), col2, yD); yD += 5;

        y = Math.max(yE, yD) + 2;
        if (r.distratores.length) {
            pdf.setFontSize(9.5); corTexto(CINZA);
            const txt = `Alternativa errada mais marcada que a correta em: ${r.distratores.map(t=>"Q"+t.questao_prova).join(", ")}.`;
            pdf.splitTextToSize(txt, LARG).forEach(l => { pdf.text(l, ME, y); y += 4.5; });
        }
        y += 4;
        pdf.setDrawColor(LINHA[0], LINHA[1], LINHA[2]); pdf.setLineWidth(0.3);
        pdf.line(ME, y, ME + LARG, y); y += 9;

        // Texto do diagnostico
        textoParaBlocos(dados.diagnostico).forEach(b => {
            if (b.t === "h4") {
                quebra(14); y += 3;
                pdf.setFont("helvetica", "bold"); pdf.setFontSize(12.5); corTexto(VERDE);
                pdf.text(limpa(b.s), ME, y); y += 7;
            } else if (b.t === "h5") {
                quebra(10); y += 1;
                pdf.setFont("helvetica", "bold"); pdf.setFontSize(10.5); corTexto(TINTA);
                pdf.text(limpa(b.s), ME, y); y += 5.5;
            } else if (b.t === "li") {
                pdf.setFont("helvetica", "normal"); pdf.setFontSize(10.5); corTexto(TINTA);
                const marca = b.n ? b.n + "." : "•";
                const ls = pdf.splitTextToSize(limpa(b.s), LARG - 7);
                quebra(ls.length * 5.2);
                pdf.text(marca, ME + 1, y);
                ls.forEach(l => { pdf.text(l, ME + 7, y); y += 5.2; });
                y += 1;
            } else {
                pdf.setFont("helvetica", "normal"); pdf.setFontSize(10.5); corTexto(TINTA);
                const ls = pdf.splitTextToSize(limpa(b.s), LARG);
                ls.forEach(l => { quebra(5.4); pdf.text(l, ME, y); y += 5.4; });
                y += 3;
            }
        });

        // Rodape em todas as paginas
        const total = pdf.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            pdf.setPage(i);
            pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); corTexto(CINZA);
            pdf.text(`Analisador de Provas  ·  ${nome}`, ME, 290);
            pdf.text(`Página ${i} de ${total}`, ME + LARG, 290, { align: "right" });
        }

        pdf.save(`diagnostico_${nome.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`);
    } catch (e) {
        alert("Erro ao gerar PDF: " + e.message);
    }
}

// Link direto para uma analise salva: index.html?analise=<id>
const analiseNaUrl = new URLSearchParams(location.search).get("analise");
if (analiseNaUrl) verAnalise(analiseNaUrl);
