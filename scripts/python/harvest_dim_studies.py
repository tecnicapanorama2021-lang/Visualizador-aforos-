"""
Script de Cosecha (Harvesting) de Estudios de Tráfico desde DIM Movilidad Bogotá
Crea un índice maestro que conecta nodos geográficos con sus estudios asociados
"""

import requests
import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
# Configuración
URL_BASE = "https://dim.movilidadbogota.gov.co/visualizacion_monitoreo/estudiosnodo"
OUTPUT_FILE = str(PROJECT_ROOT / "src" / "data" / "studies_dictionary.json")
START_ID = 1
END_ID = 2000  # Cambiar a un rango menor para pruebas rápidas, ej: 500
DELAY_BETWEEN_REQUESTS = 0.05  # Segundos entre peticiones (reducido para mayor velocidad)
PROGRESS_INTERVAL = 50  # Mostrar progreso cada N requests
SAVE_INTERVAL = 200  # Guardar progreso parcial cada N requests

# Headers para las peticiones
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'es-ES,es;q=0.9',
}


def fetch_node_studies(internal_id: int) -> Optional[Dict]:
    """
    Obtiene los estudios asociados a un nodo por su ID interno.
    
    Args:
        internal_id: ID interno del nodo
    
    Returns:
        Diccionario con la información del nodo y estudios, o None si no existe
    """
    url = f"{URL_BASE}/{internal_id}"
    
    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        
        # Si es 404, el nodo no existe
        if response.status_code == 404:
            return None
        
        # Si hay otro error HTTP, registrar y continuar
        if not response.ok:
            print(f"  [WARNING] ID {internal_id}: HTTP {response.status_code}")
            return None
        
        # Intentar parsear JSON
        try:
            data = response.json()
        except json.JSONDecodeError:
            print(f"  [WARNING] ID {internal_id}: Respuesta no es JSON válido")
            return None
        
        # Verificar que no esté vacío
        if not data or (isinstance(data, list) and len(data) == 0):
            return None
        
        # El endpoint devuelve una lista de estudios para ese nodo
        if not isinstance(data, list) or len(data) == 0:
            return None
        
        # Agrupar estudios por nombre_nodo (puede haber múltiples estudios para el mismo nodo)
        # Tomar la información del primer estudio para los datos del nodo
        first_study = data[0]
        nombre_nodo = first_study.get('nombre_nodo')
        id_nodo_interno = first_study.get('id_nodo', internal_id)
        direccion = first_study.get('direccion', '')
        
        if not nombre_nodo:
            print(f"  [WARNING] ID {internal_id}: No tiene 'nombre_nodo'")
            return None
        
        # Procesar todos los estudios de la lista
        estudios = []
        for estudio in data:
            file_id = estudio.get('id')
            fecha_inicio = estudio.get('fecha_inicio_estudio')
            fecha_fin = estudio.get('fecha_fin_estudio')
            tipo = estudio.get('nombre_tipo_estudio') or 'Volumen vehicular'
            contratistas = estudio.get('contratistas', [])
            
            if file_id:
                estudio_info = {
                    "file_id": int(file_id),
                    "date": fecha_inicio,  # Fecha de inicio del estudio
                    "date_end": fecha_fin,  # Fecha de fin del estudio
                    "type": tipo,
                    "download_url": f"https://dim.movilidadbogota.gov.co/visualizacion_monitoreo/consultararchivoscargados/{file_id}"
                }
                
                if contratistas and len(contratistas) > 0:
                    estudio_info["contractors"] = contratistas
                
                # Información adicional del estudio
                if estudio.get('total_informacion_de_volumen'):
                    estudio_info["total_records"] = estudio.get('total_informacion_de_volumen')
                if estudio.get('fechas'):
                    estudio_info["dates"] = estudio.get('fechas')
                if estudio.get('tipos_vehiculo'):
                    estudio_info["vehicle_types"] = estudio.get('tipos_vehiculo')
                
                estudios.append(estudio_info)
        
        # Construir objeto del nodo
        node_info = {
            "internal_id": int(id_nodo_interno),
            "address": direccion if direccion else nombre_nodo,
            "studies": estudios
        }
        
        # Agregar información adicional del nodo desde el primer estudio
        if first_study.get('via_principal'):
            node_info["via_principal"] = first_study.get('via_principal')
        if first_study.get('via_secundaria'):
            node_info["via_secundaria"] = first_study.get('via_secundaria')
        
        return {
            "nombre_nodo": nombre_nodo,
            "node_info": node_info
        }
        
    except requests.exceptions.Timeout:
        print(f"  [ERROR] ID {internal_id}: Timeout")
        return None
    except requests.exceptions.RequestException as e:
        print(f"  [ERROR] ID {internal_id}: {e}")
        return None
    except Exception as e:
        print(f"  [ERROR] ID {internal_id}: Error inesperado: {e}")
        return None


def harvest_studies(start_id: int, end_id: int) -> Dict[str, Dict]:
    """
    Cosecha estudios de todos los nodos en el rango especificado.
    
    Args:
        start_id: ID inicial del rango
        end_id: ID final del rango (exclusivo)
    
    Returns:
        Diccionario maestro indexado por nombre_nodo
    """
    master_index = {}
    valid_nodes = 0
    nodes_with_studies = 0
    total_studies = 0
    errors = 0
    
    print("\n" + "=" * 80)
    print("COSECHANDO ESTUDIOS DE TRÁFICO DESDE DIM MOVILIDAD BOGOTÁ")
    print("=" * 80)
    print(f"URL Base: {URL_BASE}")
    print(f"Rango de IDs: {start_id} a {end_id - 1}")
    print(f"Delay entre peticiones: {DELAY_BETWEEN_REQUESTS}s")
    print("-" * 80 + "\n")
    
    total_requests = end_id - start_id
    
    for internal_id in range(start_id, end_id):
        # Mostrar progreso cada N requests
        if (internal_id - start_id) % PROGRESS_INTERVAL == 0:
            progress = ((internal_id - start_id) / total_requests) * 100
            elapsed_time = time.time() - start_time if 'start_time' in locals() else 0
            if elapsed_time > 0:
                rate = (internal_id - start_id) / elapsed_time
                remaining = (total_requests - (internal_id - start_id)) / rate if rate > 0 else 0
                print(f"[PROGRESO] {progress:.1f}% - ID {internal_id}/{end_id-1} | Válidos: {valid_nodes} | Estudios: {total_studies} | Tiempo restante: ~{remaining:.0f}s")
            else:
                print(f"[PROGRESO] {progress:.1f}% - ID {internal_id}/{end_id-1} | Válidos: {valid_nodes} | Estudios: {total_studies}")
        
        # Iniciar timer en la primera iteración
        if internal_id == start_id:
            start_time = time.time()
        
        # Obtener estudios del nodo
        result = fetch_node_studies(internal_id)
        
        if result:
            nombre_nodo = result['nombre_nodo']
            node_info = result['node_info']
            estudios_count = len(node_info['studies'])
            
            # Guardar en el índice maestro (usando nombre_nodo como key)
            master_index[nombre_nodo] = node_info
            
            valid_nodes += 1
            total_studies += estudios_count
            
            if estudios_count > 0:
                nodes_with_studies += 1
                print(f"  [OK] ID {internal_id} -> Nodo '{nombre_nodo}': {estudios_count} estudios")
            else:
                print(f"  [OK] ID {internal_id} -> Nodo '{nombre_nodo}': Sin estudios")
        else:
            errors += 1
        
        # Guardar progreso parcial periódicamente
        if (internal_id - start_id) % SAVE_INTERVAL == 0 and master_index:
            partial_file = OUTPUT_FILE.replace('.json', f'_partial_{internal_id}.json')
            save_studies_dictionary(master_index, partial_file)
            print(f"  [GUARDADO PARCIAL] Progreso guardado en: {partial_file}")
        
        # Delay para no saturar el servidor
        time.sleep(DELAY_BETWEEN_REQUESTS)
    
    print("\n" + "=" * 80)
    print("RESUMEN DE LA COSECHA")
    print("=" * 80)
    print(f"Total de IDs procesados: {total_requests:,}")
    print(f"Nodos válidos encontrados: {valid_nodes:,}")
    print(f"Nodos con estudios: {nodes_with_studies:,}")
    print(f"Total de estudios indexados: {total_studies:,}")
    print(f"Errores/No encontrados: {errors:,}")
    print("=" * 80 + "\n")
    
    return master_index


def save_studies_dictionary(master_index: Dict[str, Dict], output_file: str) -> bool:
    """
    Guarda el diccionario maestro en formato JSON optimizado.
    
    Args:
        master_index: Diccionario maestro indexado por nombre_nodo
        output_file: Ruta del archivo de salida
    
    Returns:
        True si se guardó exitosamente, False en caso contrario
    """
    # Crear directorio si no existe
    output_dir = os.path.dirname(output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"[OK] Directorio creado: {output_dir}")
    
    # Preparar datos con metadata
    import time
    output_data = {
        "metadata": {
            "total_nodes": len(master_index),
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source": "DIM Movilidad Bogotá",
            "endpoint": URL_BASE
        },
        "nodes": master_index
    }
    
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        
        file_size = os.path.getsize(output_file)
        file_size_kb = file_size / 1024
        
        print(f"[OK] Diccionario guardado exitosamente: {output_file}")
        print(f"Tamaño del archivo: {file_size_kb:.2f} KB")
        
        # Estadísticas adicionales
        total_studies = sum(len(node.get('studies', [])) for node in master_index.values())
        nodes_with_studies = sum(1 for node in master_index.values() if len(node.get('studies', [])) > 0)
        
        print(f"\nEstadísticas del diccionario:")
        print(f"  Nodos indexados: {len(master_index):,}")
        print(f"  Nodos con estudios: {nodes_with_studies:,}")
        print(f"  Total de estudios: {total_studies:,}")
        if len(master_index) > 0:
            avg_studies = total_studies / len(master_index)
            print(f"  Promedio de estudios por nodo: {avg_studies:.2f}")
        
        return True
        
    except Exception as e:
        print(f"[ERROR] Error al guardar el archivo: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Función principal que ejecuta el proceso completo."""
    print("\n" + "=" * 80)
    print("HARVESTER DE ESTUDIOS DE TRÁFICO - DIM MOVILIDAD BOGOTÁ")
    print("=" * 80 + "\n")
    
    # Cosechar estudios
    master_index = harvest_studies(START_ID, END_ID)
    
    if not master_index:
        print("\n[WARNING] No se encontraron nodos válidos en el rango especificado")
        print("Puede que necesites ajustar el rango de IDs o verificar la URL del endpoint")
        return False
    
    # Guardar diccionario maestro
    print("\n[INFO] Guardando diccionario maestro...")
    success = save_studies_dictionary(master_index, OUTPUT_FILE)
    
    # El formato ya está optimizado con nombre_nodo como key principal
    # No necesitamos versión simplificada adicional
    
    if success:
        print("\n" + "=" * 80)
        print("PROCESO COMPLETADO EXITOSAMENTE")
        print("=" * 80)
        print(f"Archivo guardado: {OUTPUT_FILE}")
        print(f"Total de nodos indexados: {len(master_index):,}")
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
        print("[INFO] Los datos cosechados hasta ahora se pueden guardar manualmente")
        exit(1)
    except Exception as e:
        print(f"\n[ERROR] Error fatal: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
