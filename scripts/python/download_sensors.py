"""
Script "Cazador de Nodos" - Versión IDECA
Descarga la base de datos completa de sensores/nodos de tráfico desde los servidores de IDECA/Catastro.
Busca automáticamente capas relacionadas con semáforos, intersecciones, volúmenes y aforos.
"""

import requests
import json
import os
import time
from pathlib import Path

# Ruta a la raíz del proyecto (scripts/python -> scripts -> raíz)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# URLs de configuración - Servidores IDECA
PRIMARY_SERVICES = [
    "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer",
    "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/controltransito/MapServer",
    "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/senales/MapServer",
    "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Movilidad/Movilidad/MapServer"
]

OUTPUT_FILE = str(PROJECT_ROOT / "src" / "data" / "nodos_ideca.json")
BATCH_SIZE = 2000  # Tamaño de lote optimizado para MapServer de IDECA
MIN_RECORDS_THRESHOLD = 50  # Mínimo de registros para considerar una capa válida (ajustado para encontrar más capas)

# Palabras clave para identificar capas relevantes
KEYWORDS = [
    'semáforo', 'semaforo', 'semafórico', 'semáforos',
    'interseccion', 'intersección', 'intersecciones',
    'volumen', 'volúmenes', 'volumenes',
    'aforo', 'aforos', 'conteo', 'conteos',
    'nodo', 'nodos', 'monitoreo', 'monitoreos',
    'red', 'red semafórica', 'red semaforica',
    'sensor', 'sensores', 'estacion', 'estaciones'
]


def normalize_text(text):
    """Normaliza texto para comparación (sin acentos, minúsculas)."""
    if not text:
        return ""
    text = text.lower()
    replacements = {'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n'}
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def matches_keywords(text, keywords):
    """Verifica si un texto contiene alguna de las palabras clave."""
    normalized = normalize_text(text)
    for keyword in keywords:
        if normalize_text(keyword) in normalized:
            return True
    return False


def get_map_server_info(base_url):
    """Obtiene información del MapServer."""
    try:
        info_url = f"{base_url}?f=json"
        response = requests.get(info_url, timeout=20)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"[ERROR] No se pudo obtener información del MapServer: {e}")
        return None


def get_layer_info(base_url, layer_id):
    """Obtiene información detallada de una capa específica."""
    try:
        layer_url = f"{base_url}/{layer_id}?f=json"
        response = requests.get(layer_url, timeout=15)
        response.raise_for_status()
        data = response.json()
        if 'error' in data:
            return None
        return {
            'id': layer_id,
            'name': data.get('name', 'Sin nombre'),
            'type': data.get('type', 'Unknown'),
            'geometryType': data.get('geometryType', 'Unknown'),
            'description': data.get('description', '')
        }
    except Exception:
        return None


def get_layer_count(base_url, layer_id):
    """Obtiene el conteo de registros de una capa."""
    try:
        query_url = f"{base_url}/{layer_id}/query"
        params = {'where': '1=1', 'returnCountOnly': 'true', 'f': 'json'}
        response = requests.get(query_url, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()
        if 'error' in data:
            return 0
        return data.get('count', 0)
    except Exception:
        return 0


def scan_service(base_url, max_layers=40):
    """Escanea un servicio MapServer completo buscando capas relevantes."""
    print("=" * 80)
    print(f"ESCANEANDO SERVICIO: {base_url}")
    print("=" * 80)
    
    server_info = get_map_server_info(base_url)
    if not server_info:
        print("[ERROR] No se pudo obtener información del servidor")
        return []
    
    if 'layers' in server_info and server_info['layers']:
        available_layers = [layer.get('id', 0) for layer in server_info['layers']]
        max_layer_id = max(available_layers) if available_layers else 0
        max_layers = min(max_layers, max_layer_id + 1)
        print(f"Capas disponibles según el servidor: {len(server_info['layers'])}")
        print("-" * 80)
    else:
        print(f"Escaneando capas del 0 al {max_layers-1}...")
        print("-" * 80)
    
    candidates = []
    
    for layer_id in range(max_layers):
        layer_info = get_layer_info(base_url, layer_id)
        if not layer_info:
            # Intentar obtener conteo aunque no haya info de capa
            count = get_layer_count(base_url, layer_id)
            if count > 0:
                print(f"Capa {layer_id:2d} - [Sin nombre disponible]                    | {count:>8,} registros")
            continue
        
        layer_name = layer_info['name']
        count = get_layer_count(base_url, layer_id)
        matches = matches_keywords(layer_name, KEYWORDS)
        match_status = "[MATCH]" if matches else ""
        is_candidate = matches and count >= MIN_RECORDS_THRESHOLD
        status = "[CANDIDATA]" if is_candidate else ""
        
        print(f"Capa {layer_id:2d} - {layer_name[:50]:<50} | {count:>8,} registros {match_status} {status}")
        
        if is_candidate:
            candidates.append({
                'layer_id': layer_id,
                'name': layer_name,
                'count': count,
                'type': layer_info['type'],
                'geometryType': layer_info['geometryType'],
                'base_url': base_url
            })
        elif matches and count > 0:
            # Si coincide con keywords pero tiene pocos registros, también agregarlo como opción
            candidates.append({
                'layer_id': layer_id,
                'name': layer_name,
                'count': count,
                'type': layer_info['type'],
                'geometryType': layer_info['geometryType'],
                'base_url': base_url
            })
        
        time.sleep(0.3)
    
    print("-" * 80)
    
    if candidates:
        print(f"[OK] Se encontraron {len(candidates)} capa(s) candidata(s):")
        for cand in candidates:
            print(f"  - Capa {cand['layer_id']}: {cand['name']} ({cand['count']:,} registros)")
    else:
        print("[INFO] No se encontraron capas candidatas en este servicio")
    
    return candidates


def download_all_features(layer_url):
    """
    Descarga todos los features de una capa específica usando paginación.
    
    Args:
        layer_url: URL completa de la capa con /query al final
    
    Returns:
        list: Lista de todos los features descargados
    """
    all_features = []
    result_offset = 0
    total_downloaded = 0
    
    print("\n" + "=" * 70)
    print("INICIANDO DESCARGA MASIVA")
    print("=" * 70)
    print(f"URL: {layer_url}")
    print(f"Tamaño de lote: {BATCH_SIZE} registros")
    print("-" * 70)
    
    while True:
        params = {
            'where': '1=1',
            'outFields': '*',
            'f': 'json',
            'resultOffset': result_offset,
            'resultRecordCount': BATCH_SIZE,
            'outSR': '4326'
        }
        
        try:
            response = requests.get(layer_url, params=params, timeout=60)
            response.raise_for_status()
            
            data = response.json()
            
            # Verificar errores
            if 'error' in data:
                print(f"\n[ERROR] Error en la API: {data['error']}")
                break
            
            # Obtener features
            features = data.get('features', [])
            
            # Si no hay más features, terminar
            if not features or len(features) == 0:
                print(f"\n[OK] Descarga completada. No hay más registros.")
                break
            
            # Acumular features
            all_features.extend(features)
            total_downloaded += len(features)
            
            # Mostrar progreso
            print(f"[DESCARGANDO] {total_downloaded:,} registros (offset: {result_offset:,})")
            
            # Incrementar offset
            result_offset += BATCH_SIZE
            
            # Verificar si hay más registros disponibles
            exceeded_limit = data.get('exceededTransferLimit', False)
            # Si exceededTransferLimit es True, hay más datos
            # Si no hay exceededTransferLimit y recibimos menos que el batch, terminamos
            if exceeded_limit:
                # Hay más datos, continuar
                pass
            elif len(features) < BATCH_SIZE:
                print(f"\n[OK] Descarga completada. Último lote recibido.")
                break
            
            # Pequeña pausa para no sobrecargar la API
            time.sleep(0.3)
                
        except requests.exceptions.RequestException as e:
            print(f"\n[ERROR] Error en la petición HTTP: {e}")
            break
        except json.JSONDecodeError as e:
            print(f"\n[ERROR] Error al parsear JSON: {e}")
            break
        except Exception as e:
            print(f"\n[ERROR] Error inesperado: {e}")
            break
    
    print("-" * 70)
    print(f"Total de features descargados: {len(all_features):,}")
    
    return all_features


def save_geojson(features, output_file):
    """
    Guarda los features en formato GeoJSON.
    
    Args:
        features: Lista de features a guardar
        output_file: Ruta del archivo de salida
    """
    # Crear directorio si no existe
    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"[OK] Directorio creado: {output_dir}")
    
    # Convertir a formato GeoJSON
    geojson_data = {
        "type": "FeatureCollection",
        "features": features
    }
    
    # Guardar archivo JSON
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(geojson_data, f, ensure_ascii=False, indent=2)
        
        file_size = os.path.getsize(output_file)
        file_size_mb = file_size / (1024 * 1024)
        print(f"[OK] Archivo guardado exitosamente: {output_file}")
        print(f"Tamaño del archivo: {file_size_mb:.2f} MB")
        return True
        
    except Exception as e:
        print(f"[ERROR] Error al guardar el archivo: {e}")
        return False


def main():
    """Función principal que ejecuta el proceso completo."""
    print("\n" + "=" * 80)
    print("CAZADOR DE NODOS - VERSION IDECA")
    print("Buscando capas de semáforos, intersecciones y aforos en servidores IDECA")
    print("=" * 80 + "\n")
    
    all_candidates = []
    
    for service_url in PRIMARY_SERVICES:
        print(f"\n")
        candidates = scan_service(service_url, max_layers=40)
        all_candidates.extend(candidates)
        print()
    
    if not all_candidates:
        print("\n" + "=" * 80)
        print("[WARNING] No se encontraron capas candidatas que cumplan el umbral mínimo")
        print("Revisa el reporte anterior para ver las capas disponibles")
        print("=" * 80 + "\n")
        return False
    
    best_candidate = max(all_candidates, key=lambda x: x['count'])
    
    print("\n" + "=" * 80)
    print("CAPA SELECCIONADA AUTOMATICAMENTE")
    print("=" * 80)
    print(f"Servicio: {best_candidate['base_url']}")
    print(f"Capa ID: {best_candidate['layer_id']}")
    print(f"Nombre: {best_candidate['name']}")
    print(f"Registros: {best_candidate['count']:,}")
    print(f"Tipo de geometría: {best_candidate['geometryType']}")
    print("=" * 80)
    
    layer_url = f"{best_candidate['base_url']}/{best_candidate['layer_id']}/query"
    features = download_all_features(layer_url)
    
    if features:
        success = save_geojson(features, OUTPUT_FILE)
        if success:
            print("\n" + "=" * 80)
            print("PROCESO COMPLETADO EXITOSAMENTE")
            print("=" * 80)
            print(f"Archivo guardado: {OUTPUT_FILE}")
            print(f"Total de nodos/sensores descargados: {len(features):,}")
            print("=" * 80 + "\n")
            return True
    
    print("\n" + "=" * 80)
    print("EL PROCESO TERMINO CON ERRORES")
    print("=" * 80 + "\n")
    return False


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
