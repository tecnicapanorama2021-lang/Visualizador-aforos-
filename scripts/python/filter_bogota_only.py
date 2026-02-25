"""
Script para filtrar solo nodos de Bogotá
Elimina los datos de Medellín (Socrata) y conserva solo Red Semafórica SIMUR y Sensores de Velocidad
"""

import json
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INPUT_FILE = str(PROJECT_ROOT / "src" / "data" / "nodos_unificados.json")
OUTPUT_FILE = str(PROJECT_ROOT / "src" / "data" / "nodos_unificados.json")

def main():
    print("\n" + "=" * 80)
    print("FILTRANDO NODOS DE BOGOTÁ")
    print("=" * 80 + "\n")
    
    # Cargar archivo actual
    if not os.path.exists(INPUT_FILE):
        print(f"[ERROR] Archivo no encontrado: {INPUT_FILE}")
        return False
    
    print(f"[INFO] Cargando archivo: {INPUT_FILE}")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if data.get('type') != 'FeatureCollection' or 'features' not in data:
        print(f"[ERROR] Formato de archivo inválido")
        return False
    
    all_features = data['features']
    print(f"[OK] Archivo cargado: {len(all_features):,} features totales\n")
    
    # Contar por origen antes de filtrar
    origin_counts_before = {}
    for feature in all_features:
        origen = feature.get('properties', {}).get('origen', 'UNKNOWN')
        origin_counts_before[origen] = origin_counts_before.get(origen, 0) + 1
    
    print("Estadísticas ANTES del filtrado:")
    for origen, count in sorted(origin_counts_before.items()):
        print(f"  {origen}: {count:,} nodos")
    print()
    
    # Filtrar: mantener solo Red_Semaforica_SIMUR y Sensores_Velocidad
    # Eliminar Socrata_Estudios (que son de Medellín)
    filtered_features = []
    removed_count = 0
    
    for feature in all_features:
        origen = feature.get('properties', {}).get('origen', '')
        
        # Mantener solo datos de Bogotá
        if origen in ['Red_Semaforica_SIMUR', 'Sensores_Velocidad']:
            filtered_features.append(feature)
        else:
            removed_count += 1
    
    print("=" * 80)
    print("RESULTADO DEL FILTRADO")
    print("=" * 80)
    print(f"Nodos eliminados (Medellín/Socrata): {removed_count:,}")
    print(f"Nodos conservados (Bogotá): {len(filtered_features):,}\n")
    
    # Contar por origen después de filtrar
    origin_counts_after = {}
    for feature in filtered_features:
        origen = feature.get('properties', {}).get('origen', 'UNKNOWN')
        origin_counts_after[origen] = origin_counts_after.get(origen, 0) + 1
    
    print("Estadísticas DESPUÉS del filtrado:")
    for origen, count in sorted(origin_counts_after.items()):
        print(f"  {origen}: {count:,} nodos")
    print()
    
    # Actualizar metadata
    import time
    metadata = {
        "total_features": len(filtered_features),
        "sources": list(origin_counts_after.keys()),
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "filtered": True,
        "note": "Solo datos de Bogotá (excluye Medellín/Socrata)"
    }
    
    # Crear nuevo GeoJSON
    geojson_data = {
        "type": "FeatureCollection",
        "features": filtered_features,
        "metadata": metadata
    }
    
    # Guardar archivo actualizado
    print("[INFO] Guardando archivo actualizado...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, ensure_ascii=False, indent=2)
    
    file_size = os.path.getsize(OUTPUT_FILE)
    file_size_mb = file_size / (1024 * 1024)
    
    print(f"[OK] Archivo guardado: {OUTPUT_FILE}")
    print(f"Tamaño del archivo: {file_size_mb:.2f} MB")
    
    # Copiar a public/data también
    public_file = PROJECT_ROOT / "public" / "data" / "nodos_unificados.json"
    public_file.parent.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy2(OUTPUT_FILE, str(public_file))
    print(f"[OK] Archivo copiado a: {public_file}")
    
    print("\n" + "=" * 80)
    print("FILTRADO COMPLETADO EXITOSAMENTE")
    print("=" * 80)
    print(f"Total de nodos de Bogotá: {len(filtered_features):,}")
    print("=" * 80 + "\n")
    
    return True

if __name__ == "__main__":
    try:
        success = main()
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n[ERROR] Error fatal: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
