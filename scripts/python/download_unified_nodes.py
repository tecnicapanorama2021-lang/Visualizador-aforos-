"""
Script de Descarga Unificada de Nodos de Tráfico - Versión 2
Integra fuentes verificadas: Red Semafórica SIMUR + Sensores de Conteo
"""

import requests
import json
import os
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
# Configuración de fuentes de datos VERIFICADAS
SOURCES = [
    {
        "name": "Red_Semaforica_SIMUR",
        "url": "https://sig.simur.gov.co/arcgis/rest/services/DatosAbiertos/RedSemaforica/MapServer/0",
        "type": "INFRAESTRUCTURA",
        "color_ui": "#FFC107",
        "id_field": "COD_SITIO",
        "label_field": "DIRECCION"
    },
    {
        "name": "Sensores_Velocidad",
        "url": "https://services2.arcgis.com/NEwhEo9GGSHXcRXV/arcgis/rest/services/Conteo_Vehiculos_CGT_Bogot%C3%A1_D_C/FeatureServer/0",
        "type": "SENSOR_AUTO",
        "color_ui": "#00E676",
        "id_field": "siteid",
        "label_field": "name"
    }
]

OUTPUT_FILE = str(PROJECT_ROOT / "src" / "data" / "nodos_unificados.json")
BATCH_SIZE = 1000


def get_layer_count(layer_url):
    """Obtiene el conteo de registros de una capa."""
    try:
        query_url = f"{layer_url}/query"
        params = {"where": "1=1", "returnCountOnly": "true", "f": "json"}
        response = requests.get(query_url, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()
        if "error" in data:
            return 0
        return data.get("count", 0)
    except Exception as e:
        print(f"[WARNING] No se pudo obtener conteo: {e}")
        return 0


def download_all_features(layer_url, source_name, id_field=None, label_field=None):
    """
    Descarga todos los features de una capa usando paginación eficiente.
    
    Args:
        layer_url: URL completa de la capa (sin /query)
        source_name: Nombre de la fuente para logging
        id_field: Campo que contiene el ID único
        label_field: Campo que contiene el nombre/etiqueta
    
    Returns:
        list: Lista de todos los features descargados
    """
    all_features = []
    result_offset = 0
    total_downloaded = 0
    batch_number = 1
    
    print(f"\n{'='*80}")
    print(f"DESCARGANDO: {source_name}")
    print(f"{'='*80}")
    print(f"URL: {layer_url}")
    print(f"Tamaño de lote: {BATCH_SIZE} registros")
    print("-" * 80)
    
    # Obtener conteo total primero
    total_count = get_layer_count(layer_url)
    if total_count > 0:
        print(f"Total de registros disponibles: {total_count:,}")
    else:
        print("[INFO] No se pudo obtener el conteo total, continuando...")
    print("-" * 80)
    
    query_url = f"{layer_url}/query"
    
    while True:
        params = {
            "where": "1=1",
            "outFields": "*",
            "f": "json",
            "resultOffset": result_offset,
            "resultRecordCount": BATCH_SIZE,
            "outSR": "4326"
        }
        
        try:
            print(f"[BATCH {batch_number}] Descargando {source_name}: offset {result_offset:,}...")
            
            response = requests.get(query_url, params=params, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            
            # Verificar errores
            if "error" in data:
                error_msg = data["error"].get("message", str(data["error"]))
                print(f"\n[ERROR] Error en la API: {error_msg}")
                break
            
            # Obtener features
            features = data.get("features", [])
            
            # Si no hay más features, terminar
            if not features or len(features) == 0:
                print(f"\n[OK] Descarga completada. No hay más registros.")
                break
            
            # Acumular features
            all_features.extend(features)
            total_downloaded += len(features)
            
            # Mostrar progreso
            if total_count > 0:
                progress_pct = (total_downloaded / total_count * 100)
                print(f"  [OK] Batch {batch_number}: {len(features):,} registros | Total: {total_downloaded:,} / {total_count:,} ({progress_pct:.1f}%)")
            else:
                print(f"  [OK] Batch {batch_number}: {len(features):,} registros | Total acumulado: {total_downloaded:,}")
            
            batch_number += 1
            
            # Incrementar offset
            result_offset += BATCH_SIZE
            
            # Verificar si hay más registros disponibles
            exceeded_limit = data.get("exceededTransferLimit", False)
            if exceeded_limit:
                # Hay más datos, continuar
                pass
            elif len(features) < BATCH_SIZE:
                print(f"\n[OK] Descarga completada. Último lote recibido.")
                break
            
            # Pequeña pausa para no sobrecargar la API
            time.sleep(0.3)
                
        except requests.exceptions.Timeout:
            print(f"\n[ERROR] Timeout en la petición (offset: {result_offset})")
            if all_features:
                print(f"[WARNING] Retornando {len(all_features):,} features descargados hasta ahora")
            break
        except requests.exceptions.RequestException as e:
            print(f"\n[ERROR] Error en la petición HTTP: {e}")
            if all_features:
                print(f"[WARNING] Retornando {len(all_features):,} features descargados hasta ahora")
            break
        except json.JSONDecodeError as e:
            print(f"\n[ERROR] Error al parsear JSON: {e}")
            break
        except Exception as e:
            print(f"\n[ERROR] Error inesperado: {e}")
            break
    
    print("-" * 80)
    print(f"[OK] Total descargado: {len(all_features):,} features")
    
    return all_features


def normalize_feature(feature, source_config, index):
    """
    Normaliza un feature agregando campos estándar.
    """
    attributes = feature.get("attributes", {})
    geometry = feature.get("geometry", {})
    
    # Extraer ID usando el campo especificado o OBJECTID como respaldo
    feature_id = attributes.get(source_config.get("id_field")) or attributes.get("OBJECTID") or attributes.get("FID") or f"ID_{index}"
    
    # Extraer nombre usando el campo especificado o un campo común
    nombre = attributes.get(source_config.get("label_field")) or attributes.get("NOMBRE") or attributes.get("NAME") or attributes.get("DIRECCION") or f"Nodo {feature_id}"
    
    # Convertir geometría Esri a GeoJSON
    geojson_geometry = None
    if geometry:
        if "x" in geometry and "y" in geometry:
            # Punto
            geojson_geometry = {
                "type": "Point",
                "coordinates": [geometry.get("x"), geometry.get("y")]
            }
        elif "paths" in geometry:
            # Línea (MultiLineString)
            paths = geometry.get("paths", [])
            if len(paths) == 1:
                geojson_geometry = {
                    "type": "LineString",
                    "coordinates": [[coord[0], coord[1]] for coord in paths[0]]
                }
            else:
                geojson_geometry = {
                    "type": "MultiLineString",
                    "coordinates": [[[coord[0], coord[1]] for coord in path] for path in paths]
                }
        elif "rings" in geometry:
            # Polígono
            rings = geometry.get("rings", [])
            geojson_geometry = {
                "type": "Polygon",
                "coordinates": [[[coord[0], coord[1]] for coord in ring] for ring in rings]
            }
    
    # Crear feature normalizado con estructura estándar
    normalized = {
        "type": "Feature",
        "geometry": geojson_geometry,
        "properties": {
            "id": str(feature_id),
            "nombre": str(nombre) if nombre else None,
            "origen": source_config["name"],
            "tipo": source_config["type"],
            "color": source_config["color_ui"],
            # Guardamos todo el atributo raw para poder filtrar después
            "raw_data": attributes
        }
    }
    
    return normalized


def download_source(source_config):
    """
    Descarga y normaliza datos de una fuente específica.
    """
    source_name = source_config["name"]
    url = source_config["url"]
    
    print(f"\n{'='*80}")
    print(f"PROCESANDO FUENTE: {source_name}")
    print(f"{'='*80}")
    
    try:
        # Verificar que el servicio existe
        base_url = url.rsplit("/", 1)[0] if "/" in url else url
        info_url = f"{base_url}?f=json"
        
        try:
            info_response = requests.get(info_url, timeout=10)
            info_response.raise_for_status()
            info_data = info_response.json()
            
            if "error" in info_data:
                print(f"[ERROR] Servicio no encontrado: {info_data['error']}")
                return []
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                print(f"[ERROR] URL no encontrada (404): {url}")
                return []
            raise
        
        # Descargar features
        features = download_all_features(
            url, 
            source_name,
            id_field=source_config.get("id_field"),
            label_field=source_config.get("label_field")
        )
        
        if not features:
            print(f"[WARNING] No se encontraron features en {source_name}")
            return []
        
        # Normalizar features
        print(f"\n[PROCESANDO] Normalizando {len(features):,} features...")
        normalized_features = []
        for idx, feature in enumerate(features, start=1):
            normalized = normalize_feature(feature, source_config, idx)
            normalized_features.append(normalized)
        
        print(f"[OK] {len(normalized_features):,} features normalizados exitosamente")
        return normalized_features
        
    except Exception as e:
        print(f"\n[ERROR] Error procesando fuente {source_name}: {e}")
        import traceback
        traceback.print_exc()
        return []


def save_unified_geojson(all_features, output_file):
    """
    Guarda todos los features unificados en formato GeoJSON.
    """
    # Crear directorio si no existe
    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"[OK] Directorio creado: {output_dir}")
    
    # Convertir a formato GeoJSON
    geojson_data = {
        "type": "FeatureCollection",
        "features": all_features,
        "metadata": {
            "total_features": len(all_features),
            "sources": [s["name"] for s in SOURCES],
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }
    }
    
    # Guardar archivo JSON
    try:
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, ensure_ascii=False, indent=2)
        
        file_size = os.path.getsize(output_file)
        file_size_mb = file_size / (1024 * 1024)
        print(f"\n[OK] Archivo guardado exitosamente: {output_file}")
        print(f"Tamaño del archivo: {file_size_mb:.2f} MB")
        return True
        
    except Exception as e:
        print(f"[ERROR] Error al guardar el archivo: {e}")
        return False


def main():
    """Función principal que ejecuta el proceso completo."""
    print("\n" + "=" * 80)
    print("DESCARGADOR UNIFICADO DE NODOS DE TRÁFICO - VERSIÓN 2")
    print("Fuentes: Red Semafórica SIMUR + Sensores de Conteo")
    print("=" * 80 + "\n")
    
    all_features = []
    stats = {}
    
    # Procesar cada fuente
    for source_config in SOURCES:
        source_name = source_config["name"]
        features = download_source(source_config)
        
        if features:
            all_features.extend(features)
            stats[source_name] = len(features)
            print(f"\n[OK] {source_name}: {len(features):,} features agregados")
        else:
            stats[source_name] = 0
            print(f"\n[WARNING] {source_name}: No se encontraron features")
    
    # Mostrar estadísticas
    print("\n" + "=" * 80)
    print("ESTADÍSTICAS FINALES")
    print("=" * 80)
    for source_name, count in stats.items():
        print(f"  {source_name}: {count:,} features")
    print("-" * 80)
    print(f"TOTAL: {len(all_features):,} features unificados")
    print("=" * 80)
    
    # Guardar archivo unificado
    if all_features:
        success = save_unified_geojson(all_features, OUTPUT_FILE)
        if success:
            print("\n" + "=" * 80)
            print("PROCESO COMPLETADO EXITOSAMENTE")
            print("=" * 80)
            print(f"Archivo guardado: {OUTPUT_FILE}")
            print(f"Total de nodos unificados: {len(all_features):,}")
            
            # Estadísticas por tipo
            print("\nDesglose por tipo:")
            type_counts = {}
            for feature in all_features:
                source_type = feature.get("properties", {}).get("tipo", "UNKNOWN")
                type_counts[source_type] = type_counts.get(source_type, 0) + 1
            
            for source_type, count in type_counts.items():
                print(f"  {source_type}: {count:,} features")
            
            print("=" * 80 + "\n")
            return True
    
    print("\n" + "=" * 80)
    print("EL PROCESO TERMINÓ CON ERRORES O SIN DATOS")
    print("=" * 80 + "\n")
    return False


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
