#!/usr/bin/env python3
"""
Extrae tablas de un PDF y las guarda como CSV en out_dir.
Uso: python server/scripts/pdf_extract_tablas.py <pdf_path> <out_dir>

Dependencia: camelot-py (pip install "camelot-py[cv]") para PDFs con tablas.
  - En Windows/Linux: pip install "camelot-py[cv]"
  - Requiere: opencv-python, ghostscript (en PATH)
Alternativa sin Camelot: pip install pdfplumber (más ligero; ver comentarios abajo).
"""
import sys
import os

def main():
    if len(sys.argv) < 3:
        print("Uso: pdf_extract_tablas.py <pdf_path> <out_dir>", file=sys.stderr)
        sys.exit(2)

    pdf_path = os.path.abspath(sys.argv[1])
    out_dir = os.path.abspath(sys.argv[2])

    if not os.path.isfile(pdf_path):
        print(f"No existe el archivo: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(out_dir, exist_ok=True)

    exported = 0

    # Intento 1: Camelot (mejor para tablas con bordes)
    try:
        import camelot
        tables = camelot.read_pdf(pdf_path, pages="all", flavor="lattice")
        if not tables:
            tables = camelot.read_pdf(pdf_path, pages="all", flavor="stream")
        if tables:
            for i, t in enumerate(tables, start=1):
                out_file = os.path.join(out_dir, f"tabla_{i}.csv")
                t.to_csv(out_file)
                exported += 1
    except ImportError:
        pass
    except Exception as e:
        print(f"Camelot: {e}", file=sys.stderr)

    # Intento 2: pdfplumber (más ligero: pip install pdfplumber)
    if exported == 0:
        try:
            import pdfplumber
            with pdfplumber.open(pdf_path) as pdf:
                for page_num, page in enumerate(pdf.pages, start=1):
                    tables = page.extract_tables()
                    if tables:
                        for ti, table in enumerate(tables):
                            exported += 1
                            out_file = os.path.join(out_dir, f"tabla_{exported}.csv")
                            with open(out_file, "w", encoding="utf-8") as f:
                                import csv
                                writer = csv.writer(f)
                                for row in table or []:
                                    writer.writerow([(c or "").strip() if c else "" for c in row])
        except ImportError:
            print("Instala una dependencia: pip install 'camelot-py[cv]' o pip install pdfplumber", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"pdfplumber: {e}", file=sys.stderr)

    if exported == 0:
        print("No se encontraron tablas en el PDF.", file=sys.stderr)
        sys.exit(1)

    print(f"Exportadas {exported} tablas en {out_dir}", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
