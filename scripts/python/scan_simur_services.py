"""
Script de Escaneo de Servicios SIMUR
Busca la capa "Nodo contrato de monitoreo" en el catálogo de servicios de SIMUR
"""

import requests
import json
import time

# URLs base del catálogo de servicios SIMUR
BASE_URLS = [
    "https://sig.simur.gov.co/arcgis/rest/services/DatosAbiertos",
    "https://sig.simur.gov.co/arcgis/rest/services/Movilidad",
    "https://sig.simur.gov.co/arcgis/rest/services"
]

# Palabras clave para identificar capas relevantes
KEYWORDS = [
    'contrato', 'monitoreo', 'nodo', 'nodos',
    'carga', 'volumen', 'volúmenes', 'volumenes',
    'aforo', 'aforos', 'conteo', 'conteos',
    'trafico', 'tráfico', 'movilidad'
]

# Búsqueda específica para "Nodo contrato de monitoreo"
SPECIFIC_SEARCH = ['nodo contrato', 'contrato monitoreo', 'nodo monitoreo', 'contrato de monitoreo']

# Colores ANSI para terminal
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    RESET = '\033[0m'


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


def get_services_catalog(base_url):
    """Obtiene el catálogo de servicios desde la URL base."""
    try:
        url = f"{base_url}?f=json"
        print(f"\n{Colors.CYAN}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}ESCANEANDO CATÁLOGO DE SERVICIOS{Colors.RESET}")
        print(f"{Colors.CYAN}{'='*80}{Colors.RESET}")
        print(f"URL: {url}\n")
        
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        data = response.json()
        
        if 'error' in data:
            print(f"{Colors.RED}[ERROR] Error en la respuesta: {data['error']}{Colors.RESET}")
            return []
        
        services = data.get('services', [])
        print(f"{Colors.GREEN}[OK] Se encontraron {len(services)} servicios{Colors.RESET}\n")
        return services
        
    except requests.exceptions.RequestException as e:
        print(f"{Colors.RED}[ERROR] Error al obtener catálogo: {e}{Colors.RESET}")
        return []
    except Exception as e:
        print(f"{Colors.RED}[ERROR] Error inesperado: {e}{Colors.RESET}")
        return []


def get_service_layers(service_url):
    """Obtiene las capas de un servicio específico."""
    try:
        layers_url = f"{service_url}/layers?f=json"
        response = requests.get(layers_url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if 'error' in data:
            return []
        
        return data.get('layers', [])
        
    except Exception:
        return []


def get_service_info(service_url):
    """Obtiene información del servicio directamente."""
    try:
        info_url = f"{service_url}?f=json"
        response = requests.get(info_url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if 'error' in data:
            return None
        
        return data
    except Exception:
        return None


def scan_service(service, base_url=None):
    """Escanea un servicio individual buscando capas relevantes."""
    service_name = service.get('name', 'Sin nombre')
    service_type = service.get('type', 'Unknown')
    
    # Construir URL correcta
    if base_url:
        if service_name.startswith(base_url.split('/')[-1] + '/'):
            # Ya incluye el prefijo
            service_url = f"https://sig.simur.gov.co/arcgis/rest/services/{service_name}"
        else:
            service_url = f"{base_url}/{service_name}"
    else:
        # Intentar construir desde el nombre completo
        if '/' in service_name:
            service_url = f"https://sig.simur.gov.co/arcgis/rest/services/{service_name}"
        else:
            service_url = f"https://sig.simur.gov.co/arcgis/rest/services/{service_name}"
    
    print(f"{Colors.BLUE}{'-'*80}{Colors.RESET}")
    print(f"{Colors.BOLD}Servicio: {service_name}{Colors.RESET}")
    print(f"  Tipo: {service_type}")
    print(f"  URL: {service_url}")
    
    # Intentar obtener información del servicio
    service_info = get_service_info(service_url)
    
    # Obtener capas del servicio (método 1: /layers)
    layers = get_service_layers(service_url)
    
    # Si no hay capas en /layers, intentar obtener desde service_info
    if not layers and service_info:
        if 'layers' in service_info:
            layers = service_info['layers']
        elif 'subLayers' in service_info:
            layers = service_info['subLayers']
    
    # Si aún no hay capas, intentar escanear capas directamente (0-10)
    if not layers:
        print(f"  {Colors.YELLOW}[INFO] Intentando escanear capas directamente (0-10)...{Colors.RESET}")
        for layer_id in range(11):
            try:
                layer_url = f"{service_url}/{layer_id}?f=json"
                response = requests.get(layer_url, timeout=8)
                if response.ok:
                    layer_data = response.json()
                    if 'error' not in layer_data and 'name' in layer_data:
                        layer_name = layer_data.get('name', f'Capa {layer_id}')
                        # Verificar si coincide con keywords
                        if matches_keywords(layer_name, KEYWORDS) or any(
                            normalize_text(keyword) in normalize_text(layer_name) 
                            for keyword in SPECIFIC_SEARCH
                        ):
                            layers.append({
                                'id': layer_id,
                                'name': layer_name,
                                'type': layer_data.get('type', 'Unknown')
                            })
                            print(f"    {Colors.GREEN}✓ Capa {layer_id}: {layer_name}{Colors.RESET}")
                        else:
                            print(f"    Capa {layer_id}: {layer_name}")
            except Exception:
                pass
            time.sleep(0.2)
    
    if not layers:
        print(f"  {Colors.YELLOW}[INFO] No se encontraron capas o el servicio no expone capas{Colors.RESET}")
        # Verificar si el nombre del servicio coincide con keywords o búsqueda específica
        service_matches = matches_keywords(service_name, KEYWORDS) or any(
            normalize_text(keyword) in normalize_text(service_name) 
            for keyword in SPECIFIC_SEARCH
        )
        if service_matches:
            print(f"\n  {Colors.RED}{Colors.BOLD}{'!'*40}{Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}¡CANDIDATO ENCONTRADO! (Servicio completo){Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}  Servicio: {service_name}{Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}  URL: {service_url}{Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}{'!'*40}{Colors.RESET}\n")
            return [{
                'service_name': service_name,
                'service_url': service_url,
                'layer_id': 0,
                'layer_name': service_name,
                'layer_type': service_type,
                'layer_url': service_url
            }]
        return []
    
    print(f"  {Colors.GREEN}Capas encontradas: {len(layers)}{Colors.RESET}")
    
    candidates = []
    
    for layer in layers:
        layer_id = layer.get('id', 0)
        layer_name = layer.get('name', 'Sin nombre')
        layer_type = layer.get('type', 'Unknown')
        
        # Verificar si coincide con keywords o búsqueda específica
        matches = matches_keywords(layer_name, KEYWORDS) or any(
            normalize_text(keyword) in normalize_text(layer_name) 
            for keyword in SPECIFIC_SEARCH
        )
        
        if matches:
            layer_url = f"{service_url}/{layer_id}"
            candidates.append({
                'service_name': service_name,
                'service_url': service_url,
                'layer_id': layer_id,
                'layer_name': layer_name,
                'layer_type': layer_type,
                'layer_url': layer_url
            })
            
            # Imprimir en mayúsculas y rojo
            print(f"\n  {Colors.RED}{Colors.BOLD}{'!'*40}{Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}¡CANDIDATO ENCONTRADO!{Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}  Capa: {layer_name}{Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}  ID: {layer_id}{Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}  Tipo: {layer_type}{Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}  URL: {layer_url}{Colors.RESET}")
            print(f"  {Colors.RED}{Colors.BOLD}{'!'*40}{Colors.RESET}\n")
        else:
            print(f"    Capa {layer_id}: {layer_name} ({layer_type})")
    
    return candidates


def get_layer_count(layer_url):
    """Obtiene el conteo de registros de una capa."""
    try:
        query_url = f"{layer_url}/query"
        params = {"where": "1=1", "returnCountOnly": "true", "f": "json"}
        response = requests.get(query_url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        if "error" in data:
            return 0
        return data.get("count", 0)
    except Exception:
        return 0


def main():
    """Función principal que ejecuta el escaneo completo."""
    print(f"\n{Colors.BOLD}{Colors.MAGENTA}{'='*80}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.MAGENTA}ESCANER DE SERVICIOS SIMUR - BUSCANDO 'NODO CONTRATO DE MONITOREO'{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.MAGENTA}{'='*80}{Colors.RESET}\n")
    
    all_candidates = []
    total_services_scanned = 0
    
    # Escanear cada URL base
    for base_url in BASE_URLS:
        print(f"\n{Colors.BOLD}{Colors.CYAN}{'#'*80}{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.CYAN}ESCANEANDO: {base_url}{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.CYAN}{'#'*80}{Colors.RESET}\n")
        
        # Obtener catálogo de servicios
        services = get_services_catalog(base_url)
        
        if not services:
            print(f"{Colors.YELLOW}[INFO] No se encontraron servicios en esta URL base{Colors.RESET}\n")
            continue
        
        # Escanear cada servicio
        for idx, service in enumerate(services, start=1):
            print(f"\n{Colors.CYAN}[{idx}/{len(services)}] Procesando servicio...{Colors.RESET}")
            candidates = scan_service(service, base_url)
            all_candidates.extend(candidates)
            total_services_scanned += 1
            
            # Pequeña pausa para no sobrecargar el servidor
            time.sleep(0.5)
    
    # Intentar buscar directamente con variaciones del nombre
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'#'*80}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}BUSCANDO DIRECTAMENTE CON VARIACIONES DEL NOMBRE{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'#'*80}{Colors.RESET}\n")
    
    direct_urls = [
        "https://sig.simur.gov.co/arcgis/rest/services/Movilidad/NodoContratoMonitoreo/MapServer/0",
        "https://sig.simur.gov.co/arcgis/rest/services/Movilidad/NodosContratoMonitoreo/MapServer/0",
        "https://sig.simur.gov.co/arcgis/rest/services/Movilidad/Nodo_Contrato_Monitoreo/MapServer/0",
        "https://sig.simur.gov.co/arcgis/rest/services/Movilidad/Nodos_Contrato_Monitoreo/MapServer/0",
        "https://sig.simur.gov.co/arcgis/rest/services/Movilidad/ContratoMonitoreo/MapServer/0",
        "https://sig.simur.gov.co/arcgis/rest/services/Movilidad/Contrato_Monitoreo/MapServer/0",
    ]
    
    for test_url in direct_urls:
        try:
            info_url = f"{test_url}?f=json"
            response = requests.get(info_url, timeout=8)
            if response.ok:
                data = response.json()
                if 'error' not in data and 'name' in data:
                    layer_name = data.get('name', 'N/A')
                    # Obtener conteo
                    query_url = f"{test_url}/query?where=1=1&returnCountOnly=true&f=json"
                    count_response = requests.get(query_url, timeout=8)
                    count = 0
                    if count_response.ok:
                        count_data = count_response.json()
                        count = count_data.get('count', 0)
                    
                    print(f"\n{Colors.RED}{Colors.BOLD}{'!'*80}{Colors.RESET}")
                    print(f"{Colors.RED}{Colors.BOLD}¡CANDIDATO ENCONTRADO POR BÚSQUEDA DIRECTA!{Colors.RESET}")
                    print(f"{Colors.RED}{Colors.BOLD}  Nombre: {layer_name}{Colors.RESET}")
                    print(f"{Colors.RED}{Colors.BOLD}  URL: {test_url}{Colors.RESET}")
                    print(f"{Colors.RED}{Colors.BOLD}  Registros: {count:,}{Colors.RESET}")
                    print(f"{Colors.RED}{Colors.BOLD}{'!'*80}{Colors.RESET}\n")
                    
                    all_candidates.append({
                        'service_name': test_url.split('/')[-2],
                        'service_url': '/'.join(test_url.split('/')[:-1]),
                        'layer_id': 0,
                        'layer_name': layer_name,
                        'layer_type': data.get('type', 'Unknown'),
                        'layer_url': test_url
                    })
        except Exception:
            pass
        time.sleep(0.3)
    
    # Resumen final
    print(f"\n{Colors.BOLD}{Colors.MAGENTA}{'='*80}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.MAGENTA}RESUMEN FINAL{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.MAGENTA}{'='*80}{Colors.RESET}\n")
    print(f"{Colors.CYAN}Total de servicios escaneados: {total_services_scanned}{Colors.RESET}\n")
    
    if all_candidates:
        print(f"{Colors.GREEN}{Colors.BOLD}Se encontraron {len(all_candidates)} capa(s) candidata(s):{Colors.RESET}\n")
        
        for idx, candidate in enumerate(all_candidates, start=1):
            print(f"{Colors.YELLOW}{idx}. {candidate['layer_name']}{Colors.RESET}")
            print(f"   Servicio: {candidate['service_name']}")
            print(f"   Tipo: {candidate['layer_type']}")
            print(f"   URL: {candidate['layer_url']}")
            
            # Obtener conteo de registros
            count = get_layer_count(candidate['layer_url'])
            if count > 0:
                print(f"   {Colors.GREEN}Registros: {count:,}{Colors.RESET}")
            else:
                print(f"   {Colors.YELLOW}Registros: No disponible{Colors.RESET}")
            print()
    else:
        print(f"{Colors.YELLOW}[INFO] No se encontraron capas candidatas con las palabras clave buscadas{Colors.RESET}")
        print(f"{Colors.YELLOW}Palabras clave buscadas: {', '.join(KEYWORDS)}{Colors.RESET}\n")
    
    print(f"{Colors.BOLD}{Colors.MAGENTA}{'='*80}{Colors.RESET}\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}[INFO] Escaneo interrumpido por el usuario{Colors.RESET}")
    except Exception as e:
        print(f"\n{Colors.RED}[ERROR] Error fatal: {e}{Colors.RESET}")
        import traceback
        traceback.print_exc()
