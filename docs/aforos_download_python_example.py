"""
Descarga de archivos DIM — Endpoint oficial "carga_estudios/descargar/{FILE_ID}".

NUEVA LÓGICA (Infalible):

1. PASO 1: Obtener el ID del Archivo (FILE_ID).
   GET https://dim.movilidadbogota.gov.co/visualizacion_monitoreo/consultararchivoscargados/{ID_ESTUDIO}
   Parsea JSON, ordena por fecha descendente, toma el `id` del primer objeto (= FILE_ID).
   Guarda también nombre_original_archivo del paso 1.

2. PASO 2: Descargar usando la ruta oficial "carga_estudios".
   target_url = https://dim.movilidadbogota.gov.co/carga_estudios/descargar/{FILE_ID}

3. Headers de camuflaje: User-Agent, Referer.

4. Nombre del archivo: Content-Disposition de la respuesta si existe; si no, nombre_original_archivo del paso 1.
"""
import re
from datetime import datetime
from typing import Any

import requests
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

DIM_ORIGIN = "https://dim.movilidadbogota.gov.co"
DIM_BASE = f"{DIM_ORIGIN}/visualizacion_monitoreo"
DIM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://dim.movilidadbogota.gov.co/visualizacion_monitoreo/",
    "Accept": "application/json, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream, */*",
}


def _parse_instante_carga(item: dict) -> float:
    """Devuelve timestamp para ordenar; 0 si no hay instante_carga."""
    val = item.get("instante_carga")
    if val is None:
        return 0.0
    try:
        if isinstance(val, (int, float)):
            return float(val)
        if isinstance(val, datetime):
            return val.timestamp()
        if isinstance(val, str):
            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
            return dt.timestamp()
        return 0.0
    except (TypeError, ValueError):
        return 0.0


def _pick_most_recent_file(lista: list[dict]) -> dict | None:
    """Ordena por instante_carga descendente y devuelve el más reciente."""
    if not lista:
        return None
    return max(lista, key=_parse_instante_carga)


def _is_binary_response(body: bytes) -> bool:
    """True si el cuerpo parece binario (no JSON que empieza por { o [)."""
    if not body or len(body) < 1:
        return False
    return body[0] not in (0x7B, 0x5B)


def _filename_from_content_disposition(disposition: str | None) -> str | None:
    """Extrae el nombre de archivo del header Content-Disposition."""
    if not disposition:
        return None
    m = re.search(r'filename\*?=(?:UTF-8\'\')?["\']?([^"\'\s;]+)["\']?', disposition, re.I)
    return m.group(1).strip() if m else None


def download_dim_file(id_estudio: str):
    """
    Lógica simple y directa con endpoint oficial:

    1. PASO 1: GET consultararchivoscargados/{id_estudio} → parsear JSON.
       Ordenar por fecha descendente, tomar el `id` del primer objeto (= FILE_ID).
       Guardar nombre_original_archivo del primer objeto.

    2. PASO 2: GET https://dim.movilidadbogota.gov.co/carga_estudios/descargar/{FILE_ID}
       con headers User-Agent y Referer.

    3. Guardar el binario. Nombre: Content-Disposition de la respuesta si existe;
       si no, nombre_original_archivo del paso 1.
    """
    id_estudio = (id_estudio or "").strip()
    if not id_estudio:
        raise HTTPException(status_code=400, detail="id_estudio requerido")

    # ——— PASO 1: Obtener FILE_ID (lista ordenada por fecha desc, primer id) ———
    meta_url = f"{DIM_BASE}/consultararchivoscargados/{id_estudio}"
    try:
        meta_resp = requests.get(meta_url, headers=DIM_HEADERS, timeout=30)
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error conectando con DIM: {e}")

    if not meta_resp.ok:
        raise HTTPException(
            status_code=meta_resp.status_code,
            detail="El archivo no existe en DIM o el ID no es válido" if meta_resp.status_code == 404 else f"DIM respondió {meta_resp.status_code}",
        )

    try:
        data: Any = meta_resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="DIM no devolvió JSON válido")

    lista = data if isinstance(data, list) else [data]
    if not lista:
        raise HTTPException(status_code=404, detail="No hay archivos para este estudio en DIM")

    file_info = _pick_most_recent_file(lista)
    if not file_info:
        raise HTTPException(status_code=404, detail="No se pudo obtener el archivo más reciente")

    file_id = file_info.get("id") or file_info.get("id_archivo")
    if file_id is None:
        raise HTTPException(status_code=404, detail="No se encontró id del archivo en la respuesta de DIM")

    nombre_original = file_info.get("nombre_original_archivo") or f"aforo_{id_estudio}.xlsx"

    # ——— PASO 2: Descargar con endpoint oficial carga_estudios/descargar/{FILE_ID} ———
    target_url = f"{DIM_ORIGIN}/carga_estudios/descargar/{file_id}"
    try:
        file_resp = requests.get(target_url, headers=DIM_HEADERS, stream=True, timeout=60)
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error descargando archivo desde DIM: {e}")

    body = file_resp.content
    if not file_resp.ok:
        raise HTTPException(
            status_code=file_resp.status_code,
            detail="No se pudo descargar el archivo desde DIM.",
        )
    if not _is_binary_response(body):
        raise HTTPException(status_code=502, detail="DIM devolvió metadatos en lugar del archivo Excel.")

    content_type = (
        file_resp.headers.get("Content-Type")
        or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    filename = _filename_from_content_disposition(file_resp.headers.get("Content-Disposition")) or nombre_original

    def iter_bytes():
        yield body

    return StreamingResponse(
        iter_bytes(),
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
