"""
Script de Descarga de Nodos desde Socrata (Datos Abiertos de Colombia)
Extrae ubicaciones geográficas de estudios de tránsito y los consolida con nodos existentes
"""

import requests
import json
import os
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
# Configuración de endpoints Socrata
# INSTRUCCIONES PARA ENCONTRAR EL ID CORRECTO:
# 1. Ve a https://www.datos.gov.co
# 2. Busca "volúmenes vehiculares" o "aforos" o "estudios de tránsito"
# 3. Abre el dataset que contenga ubicaciones geográficas (latitud/longitud)
# 4. En la URL del dataset, encontrarás un ID como: datos.gov.co/Transporte/Volumenes/xxxx-xxxx
# 5. Copia el ID (xxxx-xxxx) y agrégalo aquí abajo
# 6. El endpoint será: https://www.datos.gov.co/resource/[ID].json

SOCRATA_ENDPOINTS = [
    # Formato 1: API de recursos (estándar)
    "https://www.datos.gov.co/resource/b9s9-jw7c.json",
    # Formato 2: API de visualización (rows.json)
    "https://www.datos.gov.co/api/views/b9s9-jw7c/rows.json",
    # Formato 3: Dominio alternativo de Socrata
    "https://colombia-mintic.data.socrata.com/resource/b9s9-jw7c.json",
]

# URL alternativa para buscar datasets
SOCRATA_SEARCH_URL = "https://www.datos.gov.co/api/views.json"

OUTPUT_FILE = str(PROJECT_ROOT / "src" / "data" / "nodos_unificados.json")
EXISTING_FILE = OUTPUT_FILE  # Mismo archivo para fusión

# Configuración de colores
COLOR_AFOROS = "#2979FF"  # Azul para aforos/estudios

# Token de aplicación de Socrata (opcional, pero puede ser necesario para algunos datasets)
# Para obtener un token: https://dev.socrata.com/register
SOCRATA_APP_TOKEN = None  # Agregar aquí tu token si es necesario
SOCRATA_APP_SECRET = None  # Agregar aquí tu secret si es necesario


def get_dataset_metadata(dataset_id: str) -> Optional[Dict]:
    """
    Obtiene metadatos del dataset para identificar si es tabular o de archivos.
    """
    try:
        metadata_url = f"https://www.datos.gov.co/api/views/{dataset_id}.json"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        }
        
        response = requests.get(metadata_url, headers=headers, timeout=15)
        if response.ok:
            return response.json()
    except Exception as e:
        print(f"[WARNING] No se pudieron obtener metadatos: {e}")
    return None


def get_federated_data_urls(metadata: Dict) -> List[str]:
    """
    Extrae las URLs de los archivos de datos de un dataset federado.
    """
    urls = []
    
    # Buscar en accessPoints
    if 'metadata' in metadata and 'accessPoints' in metadata['metadata']:
        access_points = metadata['metadata']['accessPoints']
        for content_type, url in access_points.items():
            if url:
                urls.append(url)
                print(f"[INFO] Encontrado archivo {content_type}: {url}")
    
    # Buscar en additionalAccessPoints
    if 'metadata' in metadata and 'additionalAccessPoints' in metadata['metadata']:
        for ap in metadata['metadata']['additionalAccessPoints']:
            if 'urls' in ap:
                for content_type, url in ap['urls'].items():
                    if url:
                        urls.append(url)
                        print(f"[INFO] Encontrado archivo {content_type}: {url}")
    
    return urls


def get_dataset_info(endpoint: str) -> Optional[Dict]:
    """Obtiene información sobre el dataset para identificar campos disponibles."""
    try:
        # Headers para evitar bloqueos
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        }
        
        # Agregar token de aplicación si está configurado
        if SOCRATA_APP_TOKEN:
            headers['X-App-Token'] = SOCRATA_APP_TOKEN
        if SOCRATA_APP_SECRET:
            headers['X-App-Secret'] = SOCRATA_APP_SECRET
        
        # Intentar primero sin parámetros (Socrata puede tener límites por defecto)
        print(f"[INFO] Obteniendo muestra del dataset...")
        print(f"[DEBUG] Endpoint: {endpoint}")
        
        # Si el endpoint es rows.json, puede necesitar parámetros diferentes
        if '/rows.json' in endpoint:
            # rows.json generalmente funciona sin parámetros o con ?$limit
            response = requests.get(endpoint, headers=headers, timeout=15)
        else:
            # Para resource API, intentar sin parámetros primero
            response = requests.get(endpoint, headers=headers, timeout=15)
        
        # Si falla con 403, puede ser que necesite acceso directo sin autenticación
        # Intentar diferentes estrategias
        if response.status_code == 403:
            print(f"[WARNING] 403 Forbidden recibido.")
            print(f"[INFO] El dataset puede requerir:")
            print(f"  - Token de aplicación de Socrata (configura SOCRATA_APP_TOKEN)")
            print(f"  - Acceso público habilitado en el portal")
            print(f"[INFO] Intentando acceso alternativo...")
            # Algunos datasets de Socrata requieren el formato completo
            # Intentar también con el dominio alternativo
            alt_endpoints = [
                endpoint.replace('www.datos.gov.co', 'colombia-mintic.data.socrata.com'),
                endpoint.replace('/resource/', '/api/views/').replace('.json', '/rows.json'),
            ]
            for alt_endpoint in alt_endpoints:
                try:
                    alt_response = requests.get(alt_endpoint, headers=headers, timeout=10)
                    if alt_response.ok:
                        response = alt_response
                        endpoint = alt_endpoint  # Actualizar para usar este endpoint
                        print(f"[OK] Usando endpoint alternativo: {alt_endpoint}")
                        break
                except:
                    continue
        
        # Si aún falla, intentar con límite explícito usando formato correcto
        if not response.ok:
            # En Socrata, el formato correcto es usar & en lugar de ? para parámetros adicionales
            sample_url = f"{endpoint}?$limit=5"
            response = requests.get(sample_url, headers=headers, timeout=15)
        
        response.raise_for_status()
        data = response.json()
        
        if data and len(data) > 0:
            # Analizar campos disponibles
            sample = data[0]
            print(f"[OK] Estructura del dataset obtenida. Campos: {len(sample.keys())}")
            return {
                'available': True,
                'fields': list(sample.keys()),
                'sample': sample
            }
        return None
    except Exception as e:
        print(f"[WARNING] No se pudo obtener info del dataset: {e}")
        # Intentar una última vez sin ningún parámetro
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
            response = requests.get(endpoint, headers=headers, timeout=15)
            if response.ok:
                data = response.json()
                if data and len(data) > 0:
                    sample = data[0]
                    return {
                        'available': True,
                        'fields': list(sample.keys()),
                        'sample': sample
                    }
        except:
            pass
        return None


def find_location_fields(fields: List[str], sample: Dict) -> Dict[str, str]:
    """
    Identifica automáticamente los campos de ubicación en el dataset.
    Retorna un diccionario con los nombres de campos encontrados.
    """
    field_mapping = {
        'codigo_nodo': None,
        'id_nodo': None,
        'nodo': None,
        'id_estacion': None,
        'estacion': None,
        'latitud': None,
        'lat': None,
        'latitude': None,
        'coordenaday': None,  # Campo específico de este dataset
        'longitud': None,
        'lon': None,
        'lng': None,
        'longitude': None,
        'coordenadax': None,  # Campo específico de este dataset
        'direccion': None,
        'direccion_nodo': None,
        'ubicacion': None,
        'localidad': None,
        'via_principal': None,  # Campo específico de este dataset
        'via_secundaria': None,  # Campo específico de este dataset
        'interseccion': None,  # Campo específico de este dataset
    }
    
    # Buscar campos que coincidan (case insensitive)
    fields_lower = {f.lower(): f for f in fields}
    
    # Mapear campos
    for key, value in field_mapping.items():
        if key in fields_lower:
            field_mapping[key] = fields_lower[key]
        else:
            # Buscar variaciones
            for field in fields:
                field_lower = field.lower()
                # Normalizar para comparación (sin acentos)
                field_normalized = field_lower.replace('á', 'a').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('ú', 'u').replace('ñ', 'n')
                key_normalized = key.replace('á', 'a').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('ú', 'u').replace('ñ', 'n')
                
                if key_normalized in field_normalized or field_normalized in key_normalized:
                    field_mapping[key] = field
                    break
    
    return field_mapping


def download_socrata_data(endpoint: str, limit: int = 5000, dataset_id: str = None) -> List[Dict]:
    """
    Descarga datos desde Socrata usando SoQL.
    
    Args:
        endpoint: URL del endpoint de Socrata
        limit: Límite máximo de registros a descargar
    
    Returns:
        Lista de registros descargados
    """
    print(f"\n{'='*80}")
    print(f"DESCARGANDO DATOS DESDE SOCRATA")
    print(f"{'='*80}")
    print(f"Endpoint: {endpoint}")
    print(f"Límite: {limit:,} registros")
    print("-" * 80)
    
    # Si tenemos el dataset_id, obtener metadatos primero
    if dataset_id:
        metadata = get_dataset_metadata(dataset_id)
        if metadata:
            view_type = metadata.get('viewType', 'unknown')
            print(f"[INFO] Tipo de dataset: {view_type}")
            
            # Si es un dataset federado (href), buscar URLs de archivos
            if view_type == 'href' or metadata.get('assetType') == 'federated_href':
                print(f"[INFO] Dataset federado detectado. Buscando archivos de datos...")
                data_urls = get_federated_data_urls(metadata)
                
                if data_urls:
                    # Headers para descargar archivos
                    file_headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': '*/*'
                    }
                    
                    # Intentar descargar desde las URLs encontradas
                    for data_url in data_urls:
                        print(f"\n[INFO] Intentando descargar desde: {data_url}")
                        try:
                            file_response = requests.get(data_url, headers=file_headers, timeout=30)
                            if file_response.ok:
                                # Determinar tipo de archivo
                                if data_url.endswith('.csv') or 'csv' in data_url.lower():
                                    # Procesar CSV
                                    import io
                                    import csv
                                    csv_data = file_response.text
                                    csv_reader = csv.DictReader(io.StringIO(csv_data))
                                    records_list = list(csv_reader)
                                    
                                    print(f"[OK] CSV descargado: {len(records_list)} registros")
                                    
                                    if records_list:
                                        # Identificar campos de ubicación desde el CSV
                                        sample_record = records_list[0]
                                        fields = list(sample_record.keys())
                                        field_mapping = find_location_fields(fields, sample_record)
                                        
                                        # Mapear campos encontrados
                                        id_field = field_mapping.get('nodo') or field_mapping.get('codigo_nodo') or field_mapping.get('id_nodo')
                                        lat_field = field_mapping.get('coordenaday') or field_mapping.get('latitud') or field_mapping.get('lat')
                                        lon_field = field_mapping.get('coordenadax') or field_mapping.get('longitud') or field_mapping.get('lon')
                                        name_field = (field_mapping.get('interseccion') or 
                                                     field_mapping.get('via_principal') or 
                                                     field_mapping.get('direccion'))
                                        
                                        print(f"[INFO] Campos identificados:")
                                        print(f"  ID: {id_field}")
                                        print(f"  Latitud: {lat_field}")
                                        print(f"  Longitud: {lon_field}")
                                        print(f"  Nombre: {name_field}")
                                        
                                        # Convertir a formato compatible
                                        return [{
                                            'raw': record,
                                            'id_field': id_field,
                                            'lat_field': lat_field,
                                            'lon_field': lon_field,
                                            'name_field': name_field
                                        } for record in records_list]
                                    
                                    return []
                                    
                                elif data_url.endswith('.json') or 'json' in data_url.lower():
                                    # Procesar JSON
                                    json_data = file_response.json()
                                    if isinstance(json_data, list):
                                        records_list = json_data
                                    elif isinstance(json_data, dict) and 'data' in json_data:
                                        records_list = json_data['data']
                                    else:
                                        records_list = [json_data]
                                    
                                    print(f"[OK] JSON descargado: {len(records_list)} registros")
                                    
                                    if records_list:
                                        # Identificar campos de ubicación desde el JSON
                                        sample_record = records_list[0]
                                        fields = list(sample_record.keys())
                                        field_mapping = find_location_fields(fields, sample_record)
                                        
                                        # Mapear campos encontrados
                                        id_field = field_mapping.get('nodo') or field_mapping.get('codigo_nodo')
                                        lat_field = field_mapping.get('coordenaday') or field_mapping.get('latitud')
                                        lon_field = field_mapping.get('coordenadax') or field_mapping.get('longitud')
                                        name_field = field_mapping.get('interseccion') or field_mapping.get('direccion')
                                        
                                        return [{
                                            'raw': record,
                                            'id_field': id_field,
                                            'lat_field': lat_field,
                                            'lon_field': lon_field,
                                            'name_field': name_field
                                        } for record in records_list]
                                    
                                    return []
                        except Exception as e:
                            print(f"[WARNING] Error descargando {data_url}: {e}")
                            continue
                    
                    print(f"[ERROR] No se pudieron descargar los archivos desde las URLs encontradas")
                    return []
                else:
                    print(f"[WARNING] No se encontraron URLs de archivos en los metadatos")
    
    # Primero obtener información del dataset
    dataset_info = get_dataset_info(endpoint)
    
    if not dataset_info or not dataset_info['available']:
        print(f"[ERROR] No se pudo acceder al dataset o está vacío")
        return []
    
    fields = dataset_info['fields']
    sample = dataset_info['sample']
    
    print(f"[OK] Dataset accesible. Campos encontrados: {len(fields)}")
    print(f"Campos disponibles: {', '.join(fields[:10])}{'...' if len(fields) > 10 else ''}")
    
    # Identificar campos de ubicación
    field_mapping = find_location_fields(fields, sample)
    
    # Construir query SoQL
    # Intentar diferentes combinaciones de campos según lo que esté disponible
    select_fields = []
    
    # Campos de identificación
    id_field = field_mapping.get('codigo_nodo') or field_mapping.get('id_nodo') or field_mapping.get('nodo') or field_mapping.get('id_estacion')
    if id_field:
        select_fields.append(id_field)
    
    # Campos de coordenadas (incluyendo los específicos de este dataset)
    lat_field = field_mapping.get('coordenaday') or field_mapping.get('latitud') or field_mapping.get('lat') or field_mapping.get('latitude')
    lon_field = field_mapping.get('coordenadax') or field_mapping.get('longitud') or field_mapping.get('lon') or field_mapping.get('lng') or field_mapping.get('longitude')
    
    if not lat_field or not lon_field:
        print(f"[ERROR] No se encontraron campos de coordenadas válidos")
        print(f"Campos disponibles: {fields}")
        return []
    
    select_fields.extend([lat_field, lon_field])
    
    # Campo de dirección/nombre (incluyendo campos específicos de este dataset)
    name_field = (field_mapping.get('interseccion') or 
                  field_mapping.get('via_principal') or 
                  field_mapping.get('via_secundaria') or 
                  field_mapping.get('direccion') or 
                  field_mapping.get('direccion_nodo') or 
                  field_mapping.get('ubicacion'))
    if name_field:
        select_fields.append(name_field)
    
    # Construir query - Socrata usa formato específico
    select_clause = ','.join(select_fields)
    
    # Intentar diferentes formatos de query según el tipo de endpoint
    if '/rows.json' in endpoint:
        # Para rows.json, el formato es diferente
        query_formats = [
            endpoint,  # Sin parámetros
            f"{endpoint}?$limit={limit}",  # Con límite
        ]
    else:
        # Para resource API, usar formato SoQL estándar
        query_formats = [
            endpoint,  # Sin parámetros primero
            f"{endpoint}?$limit={limit}",  # Solo límite
            f"{endpoint}?$select={select_clause}&$limit={limit}",  # Con select y límite
        ]
    
    print(f"\n[INFO] Query SoQL:")
    print(f"  SELECT: {select_clause}")
    print(f"  LIMIT: {limit}")
    print(f"\n[INFO] Descargando datos...")
    
    # Headers para evitar bloqueos
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    }
    
    # Agregar token de aplicación si está configurado
    if SOCRATA_APP_TOKEN:
        headers['X-App-Token'] = SOCRATA_APP_TOKEN
    if SOCRATA_APP_SECRET:
        headers['X-App-Secret'] = SOCRATA_APP_SECRET
    
    data = None
    for query_url in query_formats:
        try:
            print(f"[INFO] Intentando: {query_url[:100]}...")
            response = requests.get(query_url, headers=headers, timeout=30)
            
            if response.ok:
                data = response.json()
                print(f"[OK] Datos obtenidos exitosamente: {len(data):,} registros")
                break
            elif response.status_code == 400:
                print(f"[INFO] 400 recibido, probando siguiente formato...")
                continue
            else:
                response.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"[WARNING] Error con formato: {e}")
            continue
    
    if not data:
        print(f"[ERROR] No se pudo obtener datos con ningún formato de query")
        return []
    
    print(f"[OK] {len(data):,} registros descargados")
    
    # Retornar datos con mapeo de campos
    return [{
        'raw': record,
        'id_field': id_field,
        'lat_field': lat_field,
        'lon_field': lon_field,
        'name_field': name_field
    } for record in data]


def normalize_socrata_feature(record_data: Dict, index: int) -> Optional[Dict]:
    """
    Normaliza un registro de Socrata a formato GeoJSON Feature.
    
    Args:
        record_data: Datos del registro con mapeo de campos
        index: Índice del registro (para IDs fallback)
    
    Returns:
        Feature GeoJSON normalizado o None si no es válido
    """
    raw = record_data['raw']
    id_field = record_data['id_field']
    lat_field = record_data['lat_field']
    lon_field = record_data['lon_field']
    name_field = record_data['name_field']
    
    # Extraer coordenadas
    try:
        lat_str = raw.get(lat_field) if lat_field else None
        lon_str = raw.get(lon_field) if lon_field else None
        
        if not lat_str or not lon_str:
            return None
        
        # Convertir a float (manejar strings vacíos y valores None)
        try:
            lat = float(lat_str) if lat_str else None
            lon = float(lon_str) if lon_str else None
        except (ValueError, TypeError):
            return None
        
        if lat is None or lon is None:
            return None
        
        # Validar coordenadas (Bogotá está aproximadamente entre 4.0-5.0 lat y -75.0 a -74.0 lon)
        # Medellín está alrededor de 6.2 lat y -75.6 lon, así que ampliamos el rango
        if lat == 0 or lon == 0:
            return None
        
        # Validar rango aproximado (Colombia: lat 4-12, lon -79 a -66)
        # Pero nos enfocamos en Bogotá y Medellín principalmente
        if not (3.0 <= lat <= 7.0) or not (-80.0 <= lon <= -73.0):
            return None
            
    except (ValueError, TypeError, AttributeError):
        return None
    
    # Extraer ID
    if id_field and raw.get(id_field):
        feature_id = str(raw[id_field])
    else:
        feature_id = f"SOCRATA_{index}"
    
    # Extraer nombre - construir desde múltiples campos si están disponibles
    nombre_parts = []
    if name_field:
        # name_field puede ser una lista de campos separados por '|' o ser un solo campo
        if '|' in str(name_field):
            for field in str(name_field).split('|'):
                if raw.get(field):
                    nombre_parts.append(str(raw[field]))
        elif raw.get(name_field):
            nombre_parts.append(str(raw[name_field]))
    
    # También intentar con campos específicos de este dataset
    if not nombre_parts:
        if raw.get('INTERSECCIÓN') or raw.get('INTERSECCION'):
            nombre_parts.append(str(raw.get('INTERSECCIÓN') or raw.get('INTERSECCION')))
        if raw.get('VÍA_PRINCIPAL') or raw.get('VIA_PRINCIPAL'):
            via_principal = str(raw.get('VÍA_PRINCIPAL') or raw.get('VIA_PRINCIPAL'))
            via_secundaria = str(raw.get('VÍA_SECUNDARIA') or raw.get('VIA_SECUNDARIA', ''))
            if via_secundaria:
                nombre_parts.append(f"{via_principal} x {via_secundaria}")
            else:
                nombre_parts.append(via_principal)
    
    nombre = " x ".join(nombre_parts) if nombre_parts else f"Nodo {feature_id}"
    
    # Crear feature GeoJSON
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat]  # GeoJSON usa [lon, lat]
        },
        "properties": {
            "id": feature_id,
            "nombre": nombre,
            "origen": "Socrata_Estudios",
            "tipo": "AFORO_MANUAL",
            "color": COLOR_AFOROS,
            "raw_data": raw  # Guardar datos originales
        }
    }
    
    return feature


def load_existing_nodes(file_path: str) -> Dict[str, Dict]:
    """
    Carga nodos existentes desde el archivo JSON.
    
    Returns:
        Diccionario con ID como clave y feature como valor
    """
    if not os.path.exists(file_path):
        print(f"[INFO] Archivo {file_path} no existe. Se creará uno nuevo.")
        return {}
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if data.get('type') == 'FeatureCollection' and 'features' in data:
            features = data['features']
            # Crear diccionario indexado por ID para evitar duplicados
            nodes_dict = {}
            for feature in features:
                feature_id = feature.get('properties', {}).get('id')
                if feature_id:
                    nodes_dict[str(feature_id)] = feature
            
            print(f"[OK] Archivo existente cargado: {len(nodes_dict):,} nodos únicos")
            return nodes_dict
        else:
            print(f"[WARNING] Formato de archivo no reconocido")
            return {}
            
    except Exception as e:
        print(f"[ERROR] Error cargando archivo existente: {e}")
        return {}


def save_unified_geojson(all_features: List[Dict], output_file: str, metadata: Optional[Dict] = None):
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
        "metadata": metadata or {
            "total_features": len(all_features),
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }
    }
    
    # Guardar archivo JSON
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(geojson_data, f, ensure_ascii=False, indent=2)
        
        file_size = os.path.getsize(output_file)
        file_size_mb = file_size / (1024 * 1024)
        print(f"\n[OK] Archivo guardado exitosamente: {output_file}")
        print(f"Tamaño del archivo: {file_size_mb:.2f} MB")
        return True
        
    except Exception as e:
        print(f"[ERROR] Error al guardar el archivo: {e}")
        return False


def try_common_socrata_endpoints() -> List[str]:
    """
    Prueba endpoints comunes de volúmenes vehiculares en datos.gov.co
    Basado en patrones conocidos de IDs de Socrata.
    """
    print(f"\n[INFO] Probando endpoints comunes de volúmenes vehiculares...")
    
    # IDs comunes que podrían ser de volúmenes (necesitan ser verificados)
    common_ids = [
        # Agregar aquí IDs conocidos si los tienes
    ]
    
    # También intentar buscar por el portal de movilidad de Bogotá
    # El observatorio de movilidad puede tener datos en Socrata
    alternative_urls = [
        "https://www.datos.gov.co/resource/xxxx-xxxx.json",  # Placeholder
    ]
    
    return []


def search_socrata_datasets(keywords: List[str], limit: int = 10) -> List[str]:
    """
    Busca datasets en Socrata que coincidan con las palabras clave.
    
    Args:
        keywords: Lista de palabras clave para buscar
        limit: Límite de resultados
    
    Returns:
        Lista de URLs de endpoints encontrados
    """
    print(f"\n[INFO] Buscando datasets en datos.gov.co con palabras clave: {', '.join(keywords)}")
    
    # Nota: La API de búsqueda de Socrata puede requerir autenticación o tener límites
    # Por ahora, retornamos una lista vacía y el usuario puede proporcionar el ID correcto
    print(f"[INFO] Para encontrar el dataset correcto:")
    print(f"  1. Ve a https://www.datos.gov.co")
    print(f"  2. Busca 'volúmenes vehiculares' o 'aforos'")
    print(f"  3. Abre el dataset y copia el ID de la URL")
    print(f"  4. El endpoint será: https://www.datos.gov.co/resource/[ID].json")
    
    return []


def main():
    """Función principal que ejecuta el proceso completo."""
    print("\n" + "=" * 80)
    print("DESCARGADOR DE NODOS DESDE SOCRATA (DATOS ABIERTOS COLOMBIA)")
    print("=" * 80 + "\n")
    
    # Cargar nodos existentes si el archivo existe
    existing_nodes = load_existing_nodes(EXISTING_FILE)
    print(f"Nodos existentes antes de agregar Socrata: {len(existing_nodes):,}\n")
    
    # Descargar datos de Socrata
    all_socrata_features = []
    
    # Intentar endpoints configurados
    endpoints_to_try = SOCRATA_ENDPOINTS.copy()
    
    # Si los endpoints configurados fallan, mostrar instrucciones
    if not endpoints_to_try:
        print("\n" + "=" * 80)
        print("NO HAY ENDPOINTS CONFIGURADOS")
        print("=" * 80)
        print("\nPara usar este script, necesitas el ID del dataset de Socrata.")
        print("\nPASOS PARA ENCONTRAR EL ID:")
        print("1. Ve a https://www.datos.gov.co")
        print("2. Busca 'volúmenes vehiculares' o 'aforos' o 'estudios de tránsito'")
        print("3. Abre el dataset que contenga coordenadas (latitud/longitud)")
        print("4. En la URL verás algo como: datos.gov.co/Transporte/Volumenes/xxxx-xxxx")
        print("5. Copia el ID (xxxx-xxxx, formato: letras-números)")
        print("6. Edita este script y agrega el endpoint en SOCRATA_ENDPOINTS:")
        print("   SOCRATA_ENDPOINTS = [")
        print("       \"https://www.datos.gov.co/resource/[TU-ID-AQUI].json\",")
        print("   ]")
        print("\n" + "=" * 80 + "\n")
        return False
    
    for endpoint in endpoints_to_try:
        # Extraer dataset_id del endpoint si es posible
        dataset_id = None
        if 'b9s9-jw7c' in endpoint:
            dataset_id = 'b9s9-jw7c'
        elif '/resource/' in endpoint:
            dataset_id = endpoint.split('/resource/')[-1].replace('.json', '')
        elif '/api/views/' in endpoint:
            dataset_id = endpoint.split('/api/views/')[-1].split('/')[0]
        
        records = download_socrata_data(endpoint, limit=5000, dataset_id=dataset_id)
        
        if not records:
            print(f"[WARNING] No se obtuvieron datos del endpoint: {endpoint}")
            continue
        
        # Normalizar features
        print(f"\n[PROCESANDO] Normalizando {len(records):,} registros...")
        normalized_count = 0
        skipped_count = 0
        
        for idx, record_data in enumerate(records, start=1):
            normalized = normalize_socrata_feature(record_data, idx)
            if normalized:
                all_socrata_features.append(normalized)
                normalized_count += 1
            else:
                skipped_count += 1
        
        print(f"[OK] {normalized_count:,} features normalizados exitosamente")
        if skipped_count > 0:
            print(f"[INFO] {skipped_count:,} registros omitidos (coordenadas inválidas)")
        
        # Si encontramos datos, no necesitamos probar otros endpoints
        if normalized_count > 0:
            break
    
    if not all_socrata_features:
        print("\n[ERROR] No se pudieron obtener features válidos de Socrata")
        return False
    
    print(f"\n[OK] Total de features de Socrata: {len(all_socrata_features):,}")
    
    # Fusionar con nodos existentes (evitar duplicados por ID)
    print(f"\n[FUSIONANDO] Combinando con nodos existentes...")
    
    merged_nodes = existing_nodes.copy()
    new_nodes_count = 0
    duplicate_count = 0
    
    for feature in all_socrata_features:
        feature_id = feature.get('properties', {}).get('id')
        if feature_id:
            feature_id_str = str(feature_id)
            if feature_id_str not in merged_nodes:
                merged_nodes[feature_id_str] = feature
                new_nodes_count += 1
            else:
                duplicate_count += 1
    
    print(f"[OK] Nuevos nodos agregados: {new_nodes_count:,}")
    if duplicate_count > 0:
        print(f"[INFO] Nodos duplicados omitidos: {duplicate_count:,}")
    
    # Convertir diccionario a lista
    all_features = list(merged_nodes.values())
    
    # Estadísticas por origen
    print("\n" + "=" * 80)
    print("ESTADÍSTICAS FINALES")
    print("=" * 80)
    
    origin_counts = {}
    type_counts = {}
    
    for feature in all_features:
        props = feature.get('properties', {})
        origen = props.get('origen', 'UNKNOWN')
        tipo = props.get('tipo', 'UNKNOWN')
        
        origin_counts[origen] = origin_counts.get(origen, 0) + 1
        type_counts[tipo] = type_counts.get(tipo, 0) + 1
    
    print(f"\nTotal de nodos unificados: {len(all_features):,}")
    print("\nDesglose por origen:")
    for origen, count in sorted(origin_counts.items()):
        print(f"  {origen}: {count:,} nodos")
    
    print("\nDesglose por tipo:")
    for tipo, count in sorted(type_counts.items()):
        print(f"  {tipo}: {count:,} nodos")
    
    print("=" * 80)
    
    # Guardar archivo unificado
    metadata = {
        "total_features": len(all_features),
        "sources": list(origin_counts.keys()),
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "socrata_nodes_added": new_nodes_count
    }
    
    success = save_unified_geojson(all_features, OUTPUT_FILE, metadata)
    
    if success:
        print("\n" + "=" * 80)
        print("PROCESO COMPLETADO EXITOSAMENTE")
        print("=" * 80)
        print(f"Archivo guardado: {OUTPUT_FILE}")
        print(f"Total de nodos unificados: {len(all_features):,}")
        print(f"Nodos nuevos de Socrata: {new_nodes_count:,}")
        print("=" * 80 + "\n")
        return True
    
    print("\n" + "=" * 80)
    print("EL PROCESO TERMINÓ CON ERRORES")
    print("=" * 80 + "\n")
    return False


if __name__ == "__main__":
    try:
        success = main()
        exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n[INFO] Proceso interrumpido por el usuario")
        exit(1)
    except Exception as e:
        print(f"\n[ERROR] Error fatal: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
