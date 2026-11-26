# ============================================================
# MODULO: pipeline.py
# Orquestra todo o processo: extracao -> analise TCT -> agente -> diagnostico.
# E a funcao que o backend chama quando o usuario envia uma prova.
# ============================================================
import pandas as pd

import extracao
import analise_tct
import agente

def classificar_discriminacao_texto(d):
    return analise_tct.classificar_discriminacao(d)

DISCR_TEXTO = {"fraca": "fraca", "razoavel": "razoável", "boa": "boa", "otima": "ótima"}

def br(v, casas=1):
    """Formata numero no padrao brasileiro (virgula decimal, ponto de milhar)."""
    txt = f"{v:,.{casas}f}"
    return txt.replace(",", "X").replace(".", ",").replace("X", ".")

def detalhe_questao(l):
    """Uma linha com os indicadores reais de uma questao (numeracao da PROVA)."""
    txt = (f"Q{int(l['questao_prova'])}: {br(l['pct_acerto'])}% de acerto, discriminação "
           f"{DISCR_TEXTO.get(l['classif_discriminacao'], l['classif_discriminacao'])}")
    if l.get("distrator") and pd.notna(l.get("distrator_pct")):
        txt += f"; alternativa {l['distrator']} marcada por {br(l['distrator_pct'])}%"
        if l["distrator_pct"] > l["pct_acerto"]:
            txt += " (mais que a correta)"
    return txt

def montar_fatos(ranking, tabela, num_alunos, n_anuladas):
    """Todos os numeros do diagnostico, calculados aqui (a IA nao escreve numeros)."""
    foco = ranking.sort_values("media_acerto").head(3)
    temas = []
    for _, r in foco.iterrows():
        qs = tabela[tabela["tema"] == r["tema"]].sort_values("pct_acerto")
        # Pistas de interpretacao tiradas dos indicadores (orientam a IA, sem numeros)
        pistas = []
        if (qs["classif_discriminacao"] == "fraca").any():
            pistas.append("ha questao com discriminacao fraca: ate os melhores alunos erraram, "
                          "lacuna coletiva do curso")
        if ((qs["classif_discriminacao"].isin(["boa", "otima"])) & (qs["pct_acerto"] < 30)).any():
            pistas.append("acerto baixo com boa discriminacao: so os alunos mais preparados dominam o conteudo")
        if (qs["distrator_pct"] > qs["pct_acerto"]).any():
            pistas.append("um distrator superou a correta: provavel erro de conceito especifico e recorrente")
        temas.append({
            "tema": r["tema"], "media": r["media_acerto"], "n": int(r["num_questoes"]),
            "questoes": [detalhe_questao(l) for _, l in qs.iterrows()],
            "pistas": pistas,
        })
    distratores = tabela[tabela["distrator_pct"] > tabela["pct_acerto"]].sort_values("questao_prova")
    return {
        "num_alunos": int(num_alunos),
        "n_validas": len(tabela),
        "n_anuladas": int(n_anuladas),
        "media": tabela["pct_acerto"].mean(),
        "n_dificeis": int((tabela["pct_acerto"] < 30).sum()),
        "n_fraca": int((tabela["classif_discriminacao"] == "fraca").sum()),
        "distratores": [f"Q{int(q)}" for q in distratores["questao_prova"]],
        "temas": temas,
        "ranking": [(r["tema"], r["media_acerto"], int(r["num_questoes"])) for _, r in ranking.iterrows()],
    }

def montar_contexto(f):
    """Texto com os dados reais que a IA le antes de escrever (RAG)."""
    linhas = [
        f"Estudantes analisados: {f['num_alunos']}. Questoes validas: {f['n_validas']} "
        f"(anuladas pelo INEP: {f['n_anuladas']}). Acerto medio: {br(f['media'])}%.",
        f"Questoes com menos de 30% de acerto: {f['n_dificeis']}. "
        f"Questoes com discriminacao fraca: {f['n_fraca']}. "
        f"Questoes em que um distrator superou a alternativa correta: {', '.join(f['distratores']) or 'nenhuma'}.",
        "",
        "RANKING POR TEMA (menor acerto primeiro):",
    ]
    linhas += [f"- {t}: {br(m)}% ({n} questoes)" for t, m, n in f["ranking"]]
    linhas += ["", "TEMAS EM FOCO (os tres de menor acerto) E SUAS QUESTOES:"]
    for t in f["temas"]:
        linhas.append(f"- {t['tema']} ({br(t['media'])}% de acerto medio):")
        linhas += [f"    {q}" for q in t["questoes"]]
        linhas += [f"    Leitura sugerida: {p}" for p in t["pistas"]]
    return chr(10).join(linhas)

def montar_diagnostico(f, textos):
    """Monta o diagnostico final: numeros do Python + interpretacao da IA."""
    L = []
    L.append("**DIAGNÓSTICO GERAL**")
    L.append("")
    frase = (f"Foram analisadas as respostas de {br(f['num_alunos'], 0)} estudantes em "
             f"{f['n_validas']} questões válidas do componente específico")
    frase += (f" ({f['n_anuladas']} questões foram anuladas pelo INEP e ficaram fora do cálculo)."
              if f["n_anuladas"] else ".")
    frase += f" O acerto médio foi de {br(f['media'])}%"
    frase += (f", e {f['n_dificeis']} questões ficaram abaixo de 30% de acerto." if f["n_dificeis"] != 1
              else ", e 1 questão ficou abaixo de 30% de acerto.")
    if f["distratores"]:
        frase += (f" Em {len(f['distratores'])} questões ({', '.join(f['distratores'])}) uma alternativa "
                  "errada foi mais marcada que a correta." if len(f["distratores"]) > 1 else
                  f" Na {f['distratores'][0]} uma alternativa errada foi mais marcada que a correta.")
    L.append(frase)
    if textos.get("geral"):
        L.append("")
        L.append(textos["geral"])

    L += ["", "**PRINCIPAIS FRAGILIDADES**", "",
          "Os temas com menor acerto médio foram:", ""]
    for i, t in enumerate(f["temas"], 1):
        n = f"{t['n']} questão" if t["n"] == 1 else f"{t['n']} questões"
        L.append(f"{i}. **{t['tema']}**: {br(t['media'])}% de acerto médio ({n})")

    L += ["", "**ANÁLISE E RECOMENDAÇÕES POR TEMA**"]
    for t in f["temas"]:
        bloco = textos.get("temas", {}).get(t["tema"], {})
        L += ["", f"**{t['tema']}**", ""]
        L += [f"- {q}." for q in t["questoes"]]
        if bloco.get("leitura"):
            L += ["", bloco["leitura"]]
        recs = bloco.get("recomendacoes") or [
            "Retomar os conteúdos cobrados nessas questões com exercícios no mesmo formato da prova."]
        L += ["", "Recomendações:", ""]
        L += [f"- {r}" for r in recs]
    return chr(10).join(L)

def analisar_prova(caminho_pdf, caminho_arq1, caminho_arq3, co_grupo=4004,
                   questao_inicial=9, questao_final=35, offset_numeracao=8):
    import time
    t0 = time.time()

    # 1) Extrair e separar questoes do PDF
    texto = extracao.ler_pdf(caminho_pdf)
    questoes = extracao.separar_questoes(texto, questao_inicial, questao_final)
    print(f"[TEMPO] Extracao PDF: {time.time()-t0:.1f}s ({len(questoes)} questoes)")

    # 2) Classificar temas com o agente
    t1 = time.time()
    temas = agente.classificar_todas(questoes)
    temas_df = pd.DataFrame(temas)
    print(f"[TEMPO] Agente classificar temas: {time.time()-t1:.1f}s")

    # 3) Carregar dados e rodar a TCT
    t2 = time.time()
    dados = analise_tct.carregar_dados_curso(caminho_arq1, caminho_arq3, co_grupo)
    tct, num_alunos = analise_tct.analise_completa(dados)
    tct["questao_prova"] = tct["questao_analise"] + offset_numeracao
    print(f"[TEMPO] Carregar dados + TCT: {time.time()-t2:.1f}s")

    # 4) Juntar tema + TCT
    tabela = temas_df.merge(tct, on="questao_prova", how="left")
    tabela_validas = tabela.dropna(subset=["indice_dificuldade"]).copy()
    tabela_validas["pct_acerto"] = (tabela_validas["indice_dificuldade"] * 100).round(1)

    # 5) Ranking por tema
    ranking = tabela_validas.groupby("tema").agg(
        media_acerto=("pct_acerto", "mean"),
        num_questoes=("pct_acerto", "count")
    ).reset_index()
    ranking["media_acerto"] = ranking["media_acerto"].round(1)
    ranking = ranking.sort_values("media_acerto")

    # Nomes dos temas com acento para exibir
    tabela_validas["tema"] = tabela_validas["tema"].map(agente.nome_exibicao)
    ranking["tema"] = ranking["tema"].map(agente.nome_exibicao)

    # 6) Diagnostico: numeros calculados aqui + interpretacao da IA (RAG)
    t3 = time.time()
    n_anuladas = int(tct["indice_dificuldade"].isna().sum())
    fatos = montar_fatos(ranking, tabela_validas, num_alunos, n_anuladas)
    textos = agente.gerar_textos_diagnostico(montar_contexto(fatos), [t["tema"] for t in fatos["temas"]])
    diagnostico = montar_diagnostico(fatos, textos)
    print(f"[TEMPO] Agente gerar diagnostico: {time.time()-t3:.1f}s")
    print(f"[TEMPO] TOTAL: {time.time()-t0:.1f}s")

    return {
        "num_alunos": num_alunos,
        "tabela": tabela_validas,
        "ranking": ranking,
        "diagnostico": diagnostico,
    }


# Teste rapido do pipeline completo
if __name__ == "__main__":
    BASE = r"C:\Users\joaop\OneDrive\Área de Trabalho\Projeto Estagio Obrigatorio"
    PASTA_DADOS = BASE + r"\dados\microdados_enade_2021\microdados_Enade_2021_LGPD\2.DADOS"

    resultado = analisar_prova(
        caminho_pdf=BASE + r"\2021_PV_bacharelado_ciencia_computacao.pdf",
        caminho_arq1=PASTA_DADOS + r"\microdados2021_arq1.txt",
        caminho_arq3=PASTA_DADOS + r"\microdados2021_arq3.txt",
        co_grupo=4004,
    )
    print("Alunos:", resultado["num_alunos"])
    print()
    print("RANKING:")
    print(resultado["ranking"].to_string(index=False))
    print()
    print("DIAGNOSTICO (inicio):")
    print(resultado["diagnostico"][:500])
