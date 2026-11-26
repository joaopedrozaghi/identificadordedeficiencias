# ============================================================
# MODULO: agente.py
# Usa o Ollama (local) para classificar temas e gerar o diagnostico.
# ============================================================
import ollama
import os
import hashlib
import json

MODELO = "llama3.1:8b"

TEMAS_PADRAO = [
    "Algoritmos e Estrutura de Dados", "Programacao", "Banco de Dados",
    "Redes de Computadores", "Sistemas Operacionais", "Sistemas Distribuidos",
    "Engenharia de Software", "Arquitetura de Computadores", "Teoria da Computacao",
    "Logica e Matematica", "Inteligencia Artificial", "Seguranca da Informacao",
    "Interacao Humano-Computador", "Computacao Grafica", "Compiladores"
]

# Nome com acentos para mostrar no relatorio (a chave interna continua sem acento)
NOME_EXIBICAO = {
    "Algoritmos e Estrutura de Dados": "Algoritmos e Estrutura de Dados",
    "Programacao": "Programação",
    "Banco de Dados": "Banco de Dados",
    "Redes de Computadores": "Redes de Computadores",
    "Sistemas Operacionais": "Sistemas Operacionais",
    "Sistemas Distribuidos": "Sistemas Distribuídos",
    "Engenharia de Software": "Engenharia de Software",
    "Arquitetura de Computadores": "Arquitetura de Computadores",
    "Teoria da Computacao": "Teoria da Computação",
    "Logica e Matematica": "Lógica e Matemática",
    "Inteligencia Artificial": "Inteligência Artificial",
    "Seguranca da Informacao": "Segurança da Informação",
    "Interacao Humano-Computador": "Interação Humano-Computador",
    "Computacao Grafica": "Computação Gráfica",
    "Compiladores": "Compiladores",
    "Nao classificado": "Não classificado",
}

def nome_exibicao(tema):
    return NOME_EXIBICAO.get(tema, tema)

def normalizar_tema(tema_bruto, temas=None):
    """Garante que o tema retornado seja um da lista oficial."""
    if temas is None:
        temas = TEMAS_PADRAO
    if not tema_bruto or tema_bruto.strip() == "":
        return "Nao classificado"
    import unicodedata
    tb = unicodedata.normalize("NFKD", tema_bruto.strip().lower())
    tb = "".join(c for c in tb if not unicodedata.combining(c))
    if "nao_identificado" in tb or "identificado" in tb:
        return "Nao classificado"
    for t in temas:
        if t.lower() in tb or tb in t.lower():
            return t
    # tenta por palavra-chave parcial
    for t in temas:
        palavras = t.lower().split()
        if any(p in tb for p in palavras if len(p) > 4):
            return t
    return "Nao classificado"

def classificar_tema(texto_questao, temas=None):
    """Classifica o tema de UMA questao. Retorna (tema, confianca)."""
    if temas is None:
        temas = TEMAS_PADRAO
    lista = ", ".join(temas)
    prompt = (
        "Voce e um especialista em Ciencia da Computacao analisando questoes de prova. "
        "Leia a questao e identifique o TEMA principal. "
        f"Escolha APENAS UM tema EXATAMENTE como escrito na lista: {lista}. "
        "Responda EXATAMENTE no formato: "
        "TEMA: <um tema da lista> | CONFIANCA: <alta, media ou baixa>. "
        "QUESTAO: " + texto_questao
    )
    resp = ollama.chat(model=MODELO, messages=[{"role": "user", "content": prompt}])
    conteudo = resp["message"]["content"]

    tema = "NAO_IDENTIFICADO"
    confianca = "baixa"
    for parte in conteudo.replace(chr(10), " ").split("|"):
        if "TEMA:" in parte.upper():
            tema = parte.split(":", 1)[1].strip()
        if "CONFIANCA" in parte.upper():
            confianca = parte.split(":", 1)[1].strip(" .").lower()

    tema = normalizar_tema(tema, temas)
    return tema, confianca

def classificar_todas(questoes_texto, temas=None, usar_cache=True):
    """
    Classifica todas as questoes. Usa cache: se ja classificou esta mesma prova antes,
    le do arquivo em vez de chamar a IA de novo.
    """
    # Criar uma "assinatura" unica desta prova (baseada no texto das questoes)
    assinatura = hashlib.md5(str(sorted(questoes_texto.items())).encode()).hexdigest()
    pasta_cache = os.path.join(os.path.dirname(__file__), "cache")
    os.makedirs(pasta_cache, exist_ok=True)
    caminho_cache = os.path.join(pasta_cache, f"temas_{assinatura}.json")

    # Se ja existe no cache, le de la
    if usar_cache and os.path.exists(caminho_cache):
        with open(caminho_cache, "r", encoding="utf-8") as f:
            print("[CACHE] Temas carregados do cache (sem chamar a IA)")
            resultados = json.load(f)
        for r in resultados:
            r["confianca"] = str(r.get("confianca", "")).strip(" .").lower()
        return resultados

    # Senao, classifica com a IA
    resultados = []
    for numero in sorted(questoes_texto.keys()):
        tema, conf = classificar_tema(questoes_texto[numero], temas)
        resultados.append({"questao_prova": numero, "tema": tema, "confianca": conf})

    # Salva no cache para a proxima vez
    if usar_cache:
        with open(caminho_cache, "w", encoding="utf-8") as f:
            json.dump(resultados, f, ensure_ascii=False, indent=2)
        print("[CACHE] Temas salvos no cache")

    return resultados

def _sem_numeros(texto):
    """
    Remove as frases que tenham algarismos. Todos os numeros do relatorio sao
    escritos pelo Python a partir dos dados; a IA so interpreta. Assim o modelo
    nao consegue inventar ou trocar um numero.
    """
    import re
    frases = re.split(r"(?<=[.!?])\s+", str(texto or "").strip())
    texto = " ".join(f for f in frases if f and not re.search(r"\d", f)).strip()
    return _acentuar(texto)

# Termos que o modelo as vezes escreve sem acento
_SEM_ACENTO = {"discriminacao": "discriminação", "questoes": "questões", "questao": "questão",
               "computacao": "computação", "informacao": "informação", "interacao": "interação",
               "pre-requisitos": "pré-requisitos", "logica": "lógica", "matematica": "matemática"}

def _acentuar(texto):
    import re
    def troca(m):
        w = m.group(0)
        novo = _SEM_ACENTO.get(w.lower())
        if not novo:
            return w
        return novo.capitalize() if w[0].isupper() else novo
    texto = re.sub(r"[A-Za-z\-]+", troca, texto)
    # erros de digitacao e termos fora do vocabulario da TCT
    for errado, certo in (("discriminção", "discriminação"), ("A baixa acurácia", "O baixo acerto"),
                          ("a baixa acurácia", "o baixo acerto"), ("A alta acurácia", "O alto acerto"),
                          ("a alta acurácia", "o alto acerto"), ("baixa acurácia", "baixo acerto"),
                          ("acurácia", "taxa de acerto"), ("Acurácia", "Taxa de acerto")):
        texto = texto.replace(errado, certo)
    texto = texto.replace("A baixo acerto", "O baixo acerto").replace("a baixo acerto", "o baixo acerto")
    return texto

def _separar_recomendacoes(recs):
    """O modelo as vezes junta varias recomendacoes numa string separada por ';'."""
    saida = []
    for r in recs:
        for parte in str(r).split(";"):
            parte = parte.strip(" .")
            if parte:
                saida.append(parte[0].upper() + parte[1:] + ".")
    return saida

def gerar_textos_diagnostico(contexto, temas_foco):
    """
    Pede a IA apenas a parte interpretativa do diagnostico, em JSON:
      {"geral": "...", "temas": {"<tema>": {"leitura": "...", "recomendacoes": ["...", ...]}}}
    Os numeros e a ordem das fragilidades NAO vem da IA (sao montados no pipeline).
    Se a IA falhar ou devolver algo fora do formato, devolve textos vazios.
    """
    lista_temas = "; ".join(temas_foco)
    prompt = (
        "Voce e um especialista em avaliacao educacional. Analise o desempenho de estudantes "
        "de Ciencia da Computacao no ENADE usando SOMENTE os dados abaixo.\n\n"
        "DADOS:\n" + contexto + "\n\n"
        "Responda APENAS com um JSON valido neste formato:\n"
        '{"geral": "<2 a 3 frases interpretando o quadro geral>", '
        '"temas": {"<nome do tema>": {"leitura": "<1 a 2 frases sobre o que os indicadores '
        'desse tema sugerem>", "recomendacoes": ["<acao 1>", "<acao 2>", "<acao 3>"]}}}\n\n'
        "REGRAS:\n"
        f"- Em \"temas\", use exatamente estes temas, nesta ordem: {lista_temas}.\n"
        "- NAO escreva nenhum numero, porcentagem ou numero de questao: os numeros ja aparecem "
        "no relatorio. Escreva apenas a interpretacao.\n"
        "- Discriminacao fraca significa que ate os alunos de melhor desempenho erraram "
        "(lacuna coletiva); discriminacao boa ou otima com acerto baixo significa que so os "
        "melhores alunos dominam o conteudo.\n"
        "- Distrator forte (alternativa errada mais marcada que a correta) sugere um erro de "
        "conceito especifico.\n"
        "- Recomendacoes concretas para o professor do curso (atividades, revisao de "
        "pre-requisitos, exercicios), especificas do conteudo de cada tema. Evite frases genericas.\n"
        "- Portugues do Brasil, com acentos, tom profissional e direto."
    )
    vazio = {"geral": "", "temas": {}}
    try:
        resp = ollama.chat(model=MODELO, format="json",
                           messages=[{"role": "user", "content": prompt}],
                           options={"temperature": 0.3})
        dados = json.loads(resp["message"]["content"])
    except Exception as e:
        print("[AGENTE] Falha ao gerar o texto do diagnostico:", e)
        return vazio

    resultado = {"geral": _sem_numeros(dados.get("geral", "")), "temas": {}}
    temas_ia = dados.get("temas") or {}
    if not isinstance(temas_ia, dict):
        temas_ia = {}
    for tema in temas_foco:
        # aceita o tema mesmo se a IA mudar acento/maiusculas
        chave = next((k for k in temas_ia if normalizar_tema(k) == normalizar_tema(tema)), None)
        bloco = temas_ia.get(chave) if chave else None
        if not isinstance(bloco, dict):
            continue
        recs = bloco.get("recomendacoes") or []
        if isinstance(recs, str):
            recs = [recs]
        recs = [_sem_numeros(r) for r in _separar_recomendacoes(x for x in recs if isinstance(x, str))]
        resultado["temas"][tema] = {
            "leitura": _sem_numeros(bloco.get("leitura", "")),
            "recomendacoes": [r for r in recs if r][:4],
        }
    return resultado

# Teste rapido
if __name__ == "__main__":
    questao_teste = ("QUESTAO 35: Um sistema distribuido e aquele no qual os componentes "
                     "de hardware ou software, localizados em computadores interligados em rede, "
                     "comunicam-se e coordenam suas acoes enviando mensagens entre si.")
    tema, conf = classificar_tema(questao_teste)
    print(f"Tema: {tema} | Confianca: {conf}")
