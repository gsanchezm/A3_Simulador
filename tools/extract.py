"""Extrae preguntas, clave de respuestas y explicaciones del libro
"CISSP Practice Exams, Third Edition" y genera un JSON por capítulo.

Uso:  python tools/extract.py   (desde la carpeta A3_Simulador)
"""
import json
import re
import sys
from pathlib import Path

import pymupdf
import pypdf

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT.parent / "CISSP Practice Exams, Third Edition (All-in-One).pdf"

# Página inicial (0-index) de cada capítulo según el outline del PDF; el último es el Apéndice A.
BOUNDS = [17, 82, 151, 221, 282, 349, 417, 486, 545, 609, 666]
TITLES_EN = [
    "Information Security Governance and Risk Management",
    "Access Control",
    "Security Architecture and Design",
    "Physical and Environmental Security",
    "Telecommunications and Network Security",
    "Cryptography",
    "Business Continuity and Disaster Recovery",
    "Legal, Regulations, Investigations, and Compliance",
    "Software Development Security",
    "Security Operations",
]
TITLES_ES = [
    "Seguridad de la Información: Gobernanza y Gestión de Riesgos",
    "Control de Acceso",
    "Arquitectura de Seguridad y Diseño",
    "Seguridad Física y Ambiental",
    "Telecomunicaciones y Seguridad de la Red",
    "Criptografía",
    "Continuidad del Negocio y Recuperación de Desastres",
    "Regulaciones Legales, Investigaciones y Cumplimiento",
    "Seguridad del Desarrollo de Software",
    "Seguridad de las Operaciones",
]


def clean(raw: str) -> str:
    """Quita marcadores de página y líneas basura (iconos 'Q', 'A', glifos sueltos)."""
    lines = []
    for ln in raw.split("\n"):
        s = ln.strip("\r")
        st = s.strip()
        if st in ("<<PAGE>>", "Q", "A", "\ufffd", "") or re.fullmatch(r"[\ufffd\u0007\s]+", st or "x"):
            continue
        lines.append(s.replace("\ufffd", "").rstrip())
    return "\n".join(lines)


def join_lines(text: str) -> str:
    """Une líneas cortadas por el maquetado en párrafos normales."""
    text = text.strip()
    text = re.sub(r"-\n(?=[a-z])", "-", text)  # palabras compuestas cortadas
    text = re.sub(r"\s*\n\s*", " ", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def find_seq(text: str, n: int, start: int) -> int:
    """Busca el inicio de la pregunta n ('\\nn. ') a partir de start."""
    m = re.compile(rf"(?:^|\n){n}\.\s").search(text, start)
    return m.start() if m else -1


SCEN_RE = re.compile(r"\nThe following scenario[^\n]*?questions?\s+([\d,\sand]+)\.?\n")


def extract_scenarios(sec: str):
    """Quita los párrafos de escenario compartidos y devuelve (texto_limpio, {n: escenario})."""
    scen = {}
    while True:
        m = SCEN_RE.search(sec)
        if not m:
            break
        nums = [int(x) for x in re.findall(r"\d+", m.group(1))]
        nxt = find_seq(sec, nums[0], m.end() - 1)
        body = join_lines(sec[m.end():nxt])
        for n in nums:
            scen[n] = body
        sec = sec[: m.start()] + "\n" + sec[nxt:].lstrip("\n")
    return sec, scen


def parse_questions(sec: str):
    sec, scen = extract_scenarios(sec)
    qs = []
    n, pos = 1, 0
    starts = []
    while True:
        p = find_seq(sec, n, pos)
        if p < 0:
            break
        starts.append(p)
        pos = p + 1
        n += 1
    starts.append(len(sec))
    for i in range(len(starts) - 1):
        block = sec[starts[i]:starts[i + 1]].strip()
        block = re.sub(r"^\d+\.\s", "", block)
        # Opciones A-D en orden, cada una al inicio de línea
        idx = []
        p = 0
        for L in "ABCD":
            m = re.compile(rf"\n{L}\.\s").search(block, p)
            if not m:
                idx = None
                break
            idx.append(m.start())
            p = m.end()
        if idx is None:
            qs.append({"n": i + 1, "q": join_lines(block), "options": None})
            continue
        stem = join_lines(block[: idx[0]])
        opts = []
        for k in range(4):
            seg = block[idx[k]: idx[k + 1] if k < 3 else len(block)]
            opts.append(join_lines(re.sub(r"^\n?[A-D]\.\s", "", seg)))
        q = {"n": i + 1, "q": stem, "options": opts}
        if i + 1 in scen:
            q["scenario"] = scen[i + 1]
        qs.append(q)
    return qs


def parse_key(sec: str):
    return {int(n): L for n, L in re.findall(r"(\d+)\.\s*([A-D])", sec)}


def find_answer_start(sec: str, n: int, stem: str, pos: int) -> int:
    """Ubica la pregunta n en la sección de respuestas usando las primeras palabras del enunciado,
    para no confundirla con listas numeradas dentro de las explicaciones."""
    words = re.findall(r"[A-Za-z0-9]+", stem)[:4]
    if words:
        pat = rf"(?:^|\n){n}\.\s+" + r"\W+".join(map(re.escape, words))
        m = re.compile(pat).search(sec, pos)
        if m:
            return m.start()
    return find_seq(sec, n, pos)


def parse_explanations(sec: str, key: dict, stems: dict):
    out = {}
    nums = sorted(key)
    pos = 0
    starts = {}
    for n in nums:
        p = find_answer_start(sec, n, stems.get(n, ""), pos)
        if p < 0:
            continue
        starts[n] = p
        pos = p + 1
    ordered = sorted(starts.items(), key=lambda x: x[1])
    for j, (n, p) in enumerate(ordered):
        end = ordered[j + 1][1] if j + 1 < len(ordered) else len(sec)
        block = sec[p:end]
        sm = re.search(r"\nThe following scenario", block)
        if sm:  # el escenario de las siguientes preguntas no es parte de la explicación
            block = block[: sm.start()]
        # La explicación empieza en una línea ' X.' o ' X is correct.' (el glifo de check deja un espacio).
        # No dependemos de la clave rápida: el libro tiene erratas en ella.
        m = re.compile(r"\n\s+([A-D])(?:\.|\s+is\s+correct\.?)\s").search(block, max(block.find("\nA."), 0))
        if not m:
            out[n] = (None, [])
            continue
        exp = block[m.start():]
        # Separar en párrafos: la correcta y cada "X is incorrect"
        parts = re.split(r"\n\s+(?=[A-D] (?:is|are) (?:incorrect|not))", exp)
        out[n] = (m.group(1), [join_lines(re.sub(r"^\s*", "", x)) for x in parts if x.strip()])
    return out


def extract_images(doc, c: int, img_dir: Path):
    """Devuelve {n_pregunta: [ruta_relativa,...]} asignando cada imagen de la sección de preguntas
    a la última pregunta que empieza antes de ella (el libro usa 'the following graphic')."""
    result = {}
    inq, expect, cur = False, 1, None
    for i in range(BOUNDS[c], BOUNDS[c + 1]):
        page = doc[i]
        text = page.get_text()
        if "QUESTIONS" in text:
            inq = True
        if "QUICK ANSWER KEY" in text:
            break
        if not inq:
            continue
        events = []
        for b in page.get_text("blocks"):
            for ln in b[4].split("\n"):
                if ln.startswith(f"{expect}. "):
                    events.append((b[1], "Q", expect))
                    expect += 1
        for im in page.get_image_info(xrefs=True):
            events.append((im["bbox"][1], "I", im["xref"]))
        events.sort(key=lambda x: x[0])
        for _, kind, val in events:
            if kind == "Q":
                cur = val
            elif cur is not None:
                info = doc.extract_image(val)
                k = len(result.get(cur, []))
                name = f"cap{c+1:02d}_q{cur:02d}_{k}.{info['ext']}"
                (img_dir / name).write_bytes(info["image"])
                result.setdefault(cur, []).append(f"data/img/{name}")
    return result


def main():
    reader = pypdf.PdfReader(str(PDF))
    doc = pymupdf.open(str(PDF))
    img_dir = ROOT / "data" / "img"
    img_dir.mkdir(parents=True, exist_ok=True)
    chapters = []
    problems = []
    errata = []
    for c in range(10):
        raw = "\n<<PAGE>>\n".join(
            reader.pages[i].extract_text() or "" for i in range(BOUNDS[c], BOUNDS[c + 1])
        )
        t = clean(raw)
        qi = t.find("QUESTIONS")
        ki = t.find("QUICK ANSWER KEY")
        ai = t.find("ANSWERS", ki)
        qsec, ksec, asec = t[qi + len("QUESTIONS"):ki], t[ki + 16:ai], t[ai + 7:]
        qs = parse_questions(qsec)
        key = parse_key(ksec)
        exps = parse_explanations(asec, key, {q["n"]: q["q"] for q in qs})
        imgs = extract_images(doc, c, img_dir)
        for q in qs:
            exp_letter, exp_paras = exps.get(q["n"], (None, []))
            q["answer"] = exp_letter or key.get(q["n"])
            q["explanation"] = exp_paras
            if exp_letter and key.get(q["n"]) and exp_letter != key[q["n"]]:
                q["key_errata"] = key[q["n"]]
                errata.append(f"Cap {c+1} P{q['n']}: clave rápida dice {key[q['n']]}, "
                              f"la explicación dice {exp_letter}")
            if q["n"] in imgs:
                q["images"] = imgs[q["n"]]
            elif re.search(r"graphic|illustrat", q["q"], re.I):
                problems.append(f"Cap {c+1} P{q['n']}: menciona gráfico pero no tiene imagen")
            if not q["options"] or not q["answer"] or not q["explanation"]:
                problems.append(f"Cap {c+1} P{q['n']}: options={bool(q['options'])} "
                                f"answer={q['answer']} exp={bool(q['explanation'])}")
        if len(qs) != len(key):
            problems.append(f"Cap {c+1}: {len(qs)} preguntas vs {len(key)} en la clave")
        chapters.append({
            "id": c + 1,
            "title_en": TITLES_EN[c],
            "title_es": TITLES_ES[c],
            "block": 1 if c < 5 else 2,
            "questions": qs,
        })
        print(f"Cap {c+1:2d}: {len(qs)} preguntas, clave {len(key)}")

    chapter_dir = ROOT / "data" / "chapters"
    chapter_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for chapter in chapters:
        filename = f"cap{chapter['id']:02d}.json"
        (chapter_dir / filename).write_text(
            json.dumps(chapter, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
        manifest.append(f"chapters/{filename}")
    (ROOT / "data" / "exams.manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("\nTotal:", sum(len(c["questions"]) for c in chapters))
    if errata:
        print("\nERRATAS EN LA CLAVE RÁPIDA (se usa la letra de la explicación):")
        print("\n".join(errata))
    if problems:
        print("\nPROBLEMAS:")
        print("\n".join(problems))
        sys.exit(1)
    print("OK sin problemas")


if __name__ == "__main__":
    main()
