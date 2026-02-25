"""Script rápido para verificar URLs de SIMUR"""
import requests
import json

urls = [
    ('NodosContratoMonitoreo', 'https://sig.simur.gov.co/arcgis/rest/services/Movilidad/NodosContratoMonitoreo/MapServer/0'),
    ('NodoContratoMonitoreo', 'https://sig.simur.gov.co/arcgis/rest/services/Movilidad/NodoContratoMonitoreo/MapServer/0'),
    ('Nodos_Contrato_Monitoreo', 'https://sig.simur.gov.co/arcgis/rest/services/Movilidad/Nodos_Contrato_Monitoreo/MapServer/0'),
    ('Nodo_Contrato_Monitoreo', 'https://sig.simur.gov.co/arcgis/rest/services/Movilidad/Nodo_Contrato_Monitoreo/MapServer/0'),
]

print("="*80)
print("VERIFICANDO URLs DE SIMUR - NODO CONTRATO DE MONITOREO")
print("="*80)

for name, base_url in urls:
    print(f"\n--- {name} ---")
    print(f"URL Base: {base_url}")
    
    try:
        # Obtener info de la capa
        info_url = f"{base_url}?f=json"
        response = requests.get(info_url, timeout=10)
        if response.ok:
            data = response.json()
            if 'error' not in data:
                print(f"  Nombre: {data.get('name', 'N/A')}")
                print(f"  Tipo: {data.get('type', 'N/A')}")
                
                # Obtener conteo
                query_url = f"{base_url}/query?where=1=1&returnCountOnly=true&f=json"
                count_response = requests.get(query_url, timeout=10)
                if count_response.ok:
                    count_data = count_response.json()
                    count = count_data.get('count', 'N/A')
                    print(f"  Registros: {count:,}" if isinstance(count, int) else f"  Registros: {count}")
                    
                    if isinstance(count, int) and count > 0:
                        print(f"  {'*'*40}")
                        print(f"  ¡ENCONTRADO! Esta capa tiene {count:,} registros")
                        print(f"  URL Completa: {base_url}")
                        print(f"  {'*'*40}")
            else:
                print(f"  Error: {data.get('error', 'Unknown')}")
        else:
            print(f"  Status: {response.status_code}")
    except Exception as e:
        print(f"  Error: {e}")

print("\n" + "="*80)
