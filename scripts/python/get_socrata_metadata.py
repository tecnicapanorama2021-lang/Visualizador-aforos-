"""Script para obtener metadatos del dataset de Socrata"""
import requests
import json
from pathlib import Path

# Raíz del repo (scripts/python -> scripts -> raíz)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
dataset_id = "b9s9-jw7c"
metadata_url = f"https://www.datos.gov.co/api/views/{dataset_id}.json"

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
}

print("="*80)
print("OBTENIENDO METADATOS DEL DATASET")
print("="*80)
print(f"URL: {metadata_url}\n")

try:
    response = requests.get(metadata_url, headers=headers, timeout=15)
    print(f"Status: {response.status_code}")
    
    if response.ok:
        data = response.json()
        print(f"\nNombre: {data.get('name', 'N/A')}")
        print(f"Tipo: {data.get('viewType', 'N/A')}")
        print(f"Descripcion: {data.get('description', 'N/A')[:200]}...")
        
        # Información de columnas (si es tabular)
        columns = data.get('columns', [])
        if columns:
            print(f"\nColumnas disponibles ({len(columns)}):")
            for col in columns[:10]:
                print(f"  - {col.get('name', 'N/A')} ({col.get('dataTypeName', 'N/A')})")
        
        # Archivos adjuntos
        attachments = data.get('attachments', [])
        if attachments:
            print(f"\nArchivos adjuntos ({len(attachments)}):")
            for i, att in enumerate(attachments, 1):
                print(f"\n  {i}. {att.get('name', 'N/A')}")
                print(f"     Tipo: {att.get('assetType', 'N/A')}")
                print(f"     Link: {att.get('link', 'N/A')}")
                print(f"     Tamaño: {att.get('size', 'N/A')} bytes")
        else:
            print("\n[INFO] No se encontraron archivos adjuntos")
        
        # Guardar metadatos completos en data/
        out_path = PROJECT_ROOT / 'data' / 'socrata_metadata.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"\n[OK] Metadatos guardados en: {out_path}")
        
    else:
        print(f"Error: {response.status_code}")
        print(response.text[:500])
        
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
