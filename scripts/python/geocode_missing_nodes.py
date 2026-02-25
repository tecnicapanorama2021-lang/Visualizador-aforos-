"""
Script para geocodificar nodos del diccionario de estudios que no tienen coordenadas
y agregarlos al mapa
"""
import json
import os
import time
import requests
from pathlib import Path
from typing import Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent

def normalize_address_for_geocoding(address: str) -> str:
    """Normaliza una dirección para geocodificación"""
    if not address:
        return ""
    
    # Normalizar formato de intersecciones
    # Ejemplo: "AK_45_X_CL_245" -> "Autopista 45 y Calle 245, Bogotá, Colombia"
    normalized = address.upper().strip()
    
    # Reemplazar separadores
    normalized = normalized.replace("_X_", " Y ").replace("_X", " Y ").replace("X_", " Y ")
    
    # Mapear abreviaciones comunes
    replacements = {
        "AK": "Autopista",
        "KR": "Carrera",
        "CL": "Calle",
        "AC": "Avenida Calle",
        "TV": "Transversal",
        "DG": "Diagonal",
        "VIA": "Vía",
    }
    
    for abbr, full in replacements.items():
        # Reemplazar solo si es una palabra completa
        normalized = normalized.replace(f"{abbr}_", f"{full} ").replace(f" {abbr}_", f" {full} ")
    
    # Agregar Bogotá si no está
    if "BOGOTÁ" not in normalized and "BOGOTA" not in normalized:
        normalized = f"{normalized}, Bogotá, Colombia"
    else:
        normalized = f"{normalized}, Colombia"
    
    return normalized

def geocode_with_arcgis(address: str) -> Optional[Dict]:
    """Geocodifica una dirección usando ArcGIS"""
    try:
        geocode_url = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"
        
        params = {
            "f": "json",
            "singleLine": address,
            "maxLocations": 1,
            "countryCode": "CO",
            "outSR": "4326"
        }
        
        response = requests.get(geocode_url, params=params, timeout=10)
        
        if not response.ok:
            return None
        
        data = response.json()
        
        if data.get("candidates") and len(data["candidates"]) > 0:
            candidate = data["candidates"][0]
            location = candidate.get("location", {})
            
            # Solo aceptar si el score es razonable (> 70)
            if candidate.get("score", 0) >= 70:
                return {
                    "lat": location.get("y"),
                    "lng": location.get("x"),
                    "score": candidate.get("score"),
                    "address": candidate.get("address", address)
                }
        
        return None
    except Exception as e:
        print(f"  [ERROR] Error geocodificando '{address}': {e}")
        return None

def geocode_with_nominatim(address: str) -> Optional[Dict]:
    """Geocodifica usando Nominatim (OpenStreetMap) como respaldo"""
    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {
            "format": "json",
            "q": address,
            "limit": 1,
            "countrycodes": "co",
            "addressdetails": 1
        }
        
        headers = {
            "User-Agent": "PanoramaIngenieria/1.0"
        }
        
        response = requests.get(url, params=params, headers=headers, timeout=10)
        
        if not response.ok:
            return None
        
        data = response.json()
        
        if data and len(data) > 0:
            result = data[0]
            return {
                "lat": float(result.get("lat", 0)),
                "lng": float(result.get("lon", 0)),
                "score": 80,  # Score por defecto para Nominatim
                "address": result.get("display_name", address)
            }
        
        return None
    except Exception as e:
        print(f"  [ERROR] Error con Nominatim para '{address}': {e}")
        return None

def geocode_address(address: str, use_backup: bool = True) -> Optional[Dict]:
    """Geocodifica una dirección usando múltiples servicios"""
    normalized = normalize_address_for_geocoding(address)
    
    # Intentar con ArcGIS primero
    result = geocode_with_arcgis(normalized)
    
    if result:
        return result
    
    # Si falla y se permite respaldo, usar Nominatim
    if use_backup:
        result = geocode_with_nominatim(normalized)
        if result:
            return result
    
    return None

def main():
    print("=" * 80)
    print("GEOCODIFICACION DE NODOS FALTANTES DEL DICCIONARIO DE ESTUDIOS")
    print("=" * 80)
    
    # Cargar diccionario de estudios
    studies_path = PROJECT_ROOT / 'src' / 'data' / 'studies_dictionary.json'
    print("\n[1/5] Cargando diccionario de estudios...")
    with open(studies_path, 'r', encoding='utf-8') as f:
        studies_dict = json.load(f)
    
    studies_nodes = studies_dict['nodes']
    print(f"   [OK] {len(studies_nodes)} nodos en diccionario")
    
    # Cargar nodos del mapa
    nodos_path = PROJECT_ROOT / 'src' / 'data' / 'nodos_unificados.json'
    print("\n[2/5] Cargando nodos del mapa...")
    with open(nodos_path, 'r', encoding='utf-8') as f:
        map_data = json.load(f)
    
    map_features = map_data['features']
    map_node_ids = {f['properties']['id'] for f in map_features}
    print(f"   [OK] {len(map_features)} nodos en el mapa")
    
    # Identificar nodos faltantes
    print("\n[3/5] Identificando nodos faltantes...")
    missing_nodes = []
    
    for node_id, node_data in studies_nodes.items():
        # Verificar si el nodo ya está en el mapa
        if node_id in map_node_ids:
            continue
        
        address = node_data.get('address', '')
        if address:
            missing_nodes.append({
                'node_id': node_id,
                'address': address,
                'studies_count': len(node_data.get('studies', [])),
                'node_data': node_data
            })
    
    print(f"   [OK] {len(missing_nodes)} nodos faltantes identificados")
    
    if len(missing_nodes) == 0:
        print("\n[INFO] No hay nodos faltantes. Todos los nodos ya están en el mapa.")
        return
    
    # Geocodificar nodos faltantes (procesar en lotes para no saturar)
    print(f"\n[4/5] Geocodificando nodos faltantes...")
    print(f"   [INFO] Procesando {len(missing_nodes)} nodos (esto puede tomar varios minutos)...")
    print(f"   [INFO] Procesando en lotes de 5 con delay de 1 segundo entre requests...")
    
    geocoded_nodes = []
    failed_nodes = []
    
    batch_size = 5
    total_batches = (len(missing_nodes) + batch_size - 1) // batch_size
    
    # Verificar si hay un archivo de progreso guardado (en raíz del proyecto)
    progress_file = str(PROJECT_ROOT / 'geocode_progress.json')
    processed_ids = set()
    
    if os.path.exists(progress_file):
        try:
            with open(progress_file, 'r', encoding='utf-8') as f:
                progress_data = json.load(f)
                processed_ids = set(progress_data.get('processed_ids', []))
            print(f"   [INFO] Continuando desde progreso guardado: {len(processed_ids)} nodos ya procesados")
        except:
            print(f"   [INFO] No se pudo cargar progreso, comenzando desde cero")
    
    # Filtrar nodos ya procesados
    missing_nodes = [n for n in missing_nodes if n['node_id'] not in processed_ids]
    print(f"   [INFO] Nodos pendientes de procesar: {len(missing_nodes)}")
    
    for batch_idx in range(0, len(missing_nodes), batch_size):
        batch = missing_nodes[batch_idx:batch_idx + batch_size]
        current_batch = (batch_idx // batch_size) + 1
        total_batches_actual = (len(missing_nodes) + batch_size - 1) // batch_size
        
        print(f"\n   Lote {current_batch}/{total_batches_actual} ({batch_idx + 1}-{min(batch_idx + batch_size, len(missing_nodes))} de {len(missing_nodes)})...")
        
        for node_info in batch:
            node_id = node_info['node_id']
            address = node_info['address']
            
            print(f"      [{len(geocoded_nodes) + len(failed_nodes) + 1}/{len(missing_nodes)}] Nodo {node_id}...", end=" ", flush=True)
            
            result = geocode_address(address)
            
            if result:
                geocoded_nodes.append({
                    **node_info,
                    'coordinates': result
                })
                processed_ids.add(node_id)
                print(f"[OK]")
            else:
                failed_nodes.append(node_info)
                processed_ids.add(node_id)  # Marcar como procesado aunque haya fallado
                print("[FAILED]")
            
            # Guardar progreso cada 10 nodos
            if (len(geocoded_nodes) + len(failed_nodes)) % 10 == 0:
                with open(progress_file, 'w', encoding='utf-8') as f:
                    json.dump({'processed_ids': list(processed_ids)}, f, indent=2)
            
            # Delay para no saturar los servicios
            time.sleep(1.0)
    
    print(f"\n   [OK] {len(geocoded_nodes)} nodos geocodificados exitosamente")
    print(f"   [WARNING] {len(failed_nodes)} nodos no pudieron ser geocodificados")
    
    # Crear features GeoJSON para los nodos geocodificados
    print(f"\n[5/5] Creando features GeoJSON...")
    new_features = []
    
    for node_info in geocoded_nodes:
        node_id = node_info['node_id']
        coords = node_info['coordinates']
        node_data = node_info['node_data']
        
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [coords['lng'], coords['lat']]
            },
            "properties": {
                "id": node_id,
                "nombre": node_data.get('address', ''),
                "origen": "DIM_Estudios_Geocodificado",
                "tipo": "AFORO_MANUAL",
                "color": "#2979FF",
                "has_studies": True,
                "studies_count": node_info['studies_count'],
                "geocoded": True,
                "geocoding_score": coords.get('score', 0),
                "geocoded_address": coords.get('address', '')
            }
        }
        
        new_features.append(feature)
    
    # Agregar nuevos features al mapa
    if new_features:
        map_data['features'].extend(new_features)
        print(f"   [OK] {len(new_features)} nuevos features creados")
        
        # Guardar archivo actualizado
        output_file = str(PROJECT_ROOT / 'src' / 'data' / 'nodos_unificados.json')
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(map_data, f, ensure_ascii=False, indent=2)
        
        print(f"\n[OK] Archivo actualizado: {output_file}")
        print(f"   Total de nodos ahora: {len(map_data['features'])}")
        
        # Copiar a public/data
        public_file = PROJECT_ROOT / 'public' / 'data' / 'nodos_unificados.json'
        public_file.parent.mkdir(parents=True, exist_ok=True)
        with open(public_file, 'w', encoding='utf-8') as f:
            json.dump(map_data, f, ensure_ascii=False, indent=2)
        print(f"   [OK] Copiado a: {public_file}")
        
        # Limpiar archivo de progreso si se completó todo
        if len(missing_nodes) == len(geocoded_nodes) + len(failed_nodes):
            if os.path.exists(progress_file):
                os.remove(progress_file)
                print(f"   [OK] Progreso completado, archivo de progreso eliminado")
    else:
        print("   [WARNING] No se crearon nuevos features")
    
    # Resumen final
    print("\n" + "=" * 80)
    print("RESUMEN FINAL")
    print("=" * 80)
    print(f"Nodos en diccionario: {len(studies_nodes)}")
    print(f"Nodos ya en el mapa: {len([n for n in studies_nodes.keys() if n in map_node_ids])}")
    print(f"Nodos geocodificados: {len(geocoded_nodes)}")
    print(f"Nodos que fallaron: {len(failed_nodes)}")
    print(f"Total de nodos en el mapa ahora: {len(map_data['features'])}")
    print("=" * 80)
    
    if failed_nodes:
        print(f"\n[WARNING] Nodos que no pudieron ser geocodificados (primeros 10):")
        for node in failed_nodes[:10]:
            print(f"   - ID: {node['node_id']} - Direccion: {node['address']}")

if __name__ == "__main__":
    main()
