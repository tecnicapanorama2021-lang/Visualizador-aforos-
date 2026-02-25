"""Script para buscar el dataset de volúmenes vehiculares en datos.gov.co"""
import requests
import json

print("Buscando datasets de volúmenes vehiculares en datos.gov.co...\n")

# Buscar datasets
search_queries = [
    "volumen vehicular bogota",
    "aforos vehiculares",
    "volumenes vehiculares",
    "estudios transito bogota"
]

for query in search_queries:
    print(f"Buscando: '{query}'")
    try:
        url = f"https://www.datos.gov.co/api/views.json?q={query.replace(' ', '+')}&$limit=5"
        response = requests.get(url, timeout=10)
        if response.ok:
            data = response.json()
            if data:
                print(f"  Encontrados {len(data)} datasets:")
                for dataset in data[:3]:
                    name = dataset.get('name', 'N/A')
                    dataset_id = dataset.get('id', 'N/A')
                    print(f"    - {name}")
                    print(f"      ID: {dataset_id}")
                    print(f"      Endpoint: https://www.datos.gov.co/resource/{dataset_id}.json")
                    print()
            else:
                print("  No se encontraron resultados\n")
        else:
            print(f"  Error: {response.status_code}\n")
    except Exception as e:
        print(f"  Error: {e}\n")
