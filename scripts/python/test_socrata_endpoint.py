"""Script de prueba para verificar acceso al dataset de Socrata"""
import requests
import json

dataset_id = "b9s9-jw7c"
base_url = "https://www.datos.gov.co"

# Diferentes formatos de endpoint a probar
endpoints = [
    f"{base_url}/resource/{dataset_id}.json",
    f"{base_url}/api/views/{dataset_id}/rows.json",
    f"{base_url}/api/views/{dataset_id}/rows.json?$limit=10",
]

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
}

print("="*80)
print("PROBANDO ENDPOINTS DE SOCRATA PARA DATASET b9s9-jw7c")
print("="*80)

for endpoint in endpoints:
    print(f"\n{'='*80}")
    print(f"Probando: {endpoint}")
    print("-"*80)
    
    try:
        response = requests.get(endpoint, headers=headers, timeout=15)
        print(f"Status Code: {response.status_code}")
        print(f"Content-Type: {response.headers.get('Content-Type', 'N/A')}")
        
        if response.ok:
            try:
                data = response.json()
                if isinstance(data, list):
                    print(f"[OK] EXITO: {len(data)} registros obtenidos")
                    if len(data) > 0:
                        print(f"Campos disponibles: {list(data[0].keys())[:10]}")
                        print(f"\nPrimer registro (muestra):")
                        sample = {k: v for k, v in list(data[0].items())[:5]}
                        print(json.dumps(sample, indent=2, ensure_ascii=False))
                elif isinstance(data, dict):
                    print(f"Respuesta es un objeto JSON:")
                    print(f"Claves: {list(data.keys())[:10]}")
                    if 'data' in data:
                        print(f"Registros en 'data': {len(data['data'])}")
            except json.JSONDecodeError:
                print(f"Error: No se pudo parsear como JSON")
                print(f"Contenido (primeros 500 chars): {response.text[:500]}")
        else:
            print(f"[ERROR] Status: {response.status_code}")
            try:
                error_data = response.json()
                print(f"Mensaje de error: {json.dumps(error_data, indent=2, ensure_ascii=False)}")
            except:
                print(f"Respuesta: {response.text[:500]}")
                
    except Exception as e:
        print(f"[ERROR] Excepcion: {e}")

print("\n" + "="*80)
